// Minimal JSON-file backed table store with a tiny Supabase-like query DSL.
// Tables = arrays of rows (objects) saved to one JSON file per table in a folder.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let DIR = "";
const cache = new Map();

const TABLES = [
  "calc_rows", "chaves_pix", "dkdash_credentials", "slot_mapping_codes",
  "wa_keywords", "wa_messages", "wa_live_messages", "wa_tasks", "wa_tokens",
  "app_settings", "push_subscriptions", "dkdash_cache",
];

function fileFor(table) { return path.join(DIR, `${table}.json`); }

function load(table) {
  if (cache.has(table)) return cache.get(table);
  const f = fileFor(table);
  let rows = [];
  if (fs.existsSync(f)) {
    try { rows = JSON.parse(fs.readFileSync(f, "utf8")); } catch { rows = []; }
  }
  if (!Array.isArray(rows)) rows = [];
  cache.set(table, rows);
  return rows;
}

// Escrita assíncrona com debounce por tabela. Cada save() marca a tabela como
// "suja" e agenda um flush ~250ms depois — múltiplas mutações em rajada
// (backfill, pull de mensagens) viram UMA única gravação, sem bloquear o
// event loop com writeFileSync a cada linha.
const dirty = new Set();
const flushTimers = new Map();
const FLUSH_MS = 250;
// Cap por tabela: mantém apenas as N linhas mais recentes por created_at.
const ROW_CAPS = { wa_live_messages: 1000, wa_messages: 2000 };

function capTable(table) {
  const cap = ROW_CAPS[table];
  if (!cap) return;
  const rows = cache.get(table);
  if (!Array.isArray(rows) || rows.length <= cap) return;
  rows.sort((a, b) => new Date(a?.created_at || 0) - new Date(b?.created_at || 0));
  const trimmed = rows.slice(rows.length - cap);
  cache.set(table, trimmed);
}

function flushNow(table) {
  const t = flushTimers.get(table);
  if (t) { clearTimeout(t); flushTimers.delete(table); }
  if (!dirty.has(table)) return;
  dirty.delete(table);
  try {
    capTable(table);
    const rows = cache.get(table) || [];
    // JSON compacto (sem indent) — ~50% mais rápido/menor.
    const data = JSON.stringify(rows);
    const tmp = fileFor(table) + ".tmp";
    fs.writeFile(tmp, data, (err) => {
      if (err) { console.warn("[db] flush", table, err.message); return; }
      fs.rename(tmp, fileFor(table), (err2) => {
        if (err2) console.warn("[db] rename", table, err2.message);
      });
    });
  } catch (e) {
    console.warn("[db] flush erro", table, e?.message || e);
  }
}

function save(table) {
  dirty.add(table);
  if (flushTimers.has(table)) return;
  flushTimers.set(table, setTimeout(() => flushNow(table), FLUSH_MS));
}

// Flush síncrono no shutdown, pra não perder dados pendentes.
function flushAllSync() {
  for (const table of Array.from(dirty)) {
    const t = flushTimers.get(table);
    if (t) { clearTimeout(t); flushTimers.delete(table); }
    dirty.delete(table);
    try {
      capTable(table);
      const rows = cache.get(table) || [];
      fs.writeFileSync(fileFor(table), JSON.stringify(rows));
    } catch (e) {
      console.warn("[db] flushAllSync", table, e?.message || e);
    }
  }
}
try {
  process.on("exit", flushAllSync);
  process.on("SIGINT", () => { flushAllSync(); process.exit(0); });
  process.on("SIGTERM", () => { flushAllSync(); process.exit(0); });
} catch {}

function init(dir) {
  DIR = dir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Migração: versões antigas salvavam os JSON em <parent>/ (ex: rolls-data/*.json).
  // Agora usamos <parent>/db/*.json. Copia arquivos que ainda não existem no novo lugar.
  try {
    const parent = path.dirname(dir);
    for (const t of TABLES) {
      const oldFile = path.join(parent, `${t}.json`);
      const newFile = path.join(dir, `${t}.json`);
      if (!fs.existsSync(oldFile)) continue;
      let shouldCopy = !fs.existsSync(newFile);
      if (!shouldCopy && fs.existsSync(newFile)) {
        try {
          const current = JSON.parse(fs.readFileSync(newFile, "utf8"));
          shouldCopy = !Array.isArray(current) || current.length === 0;
        } catch {
          shouldCopy = true;
        }
      }
      if (shouldCopy) {
        try { fs.copyFileSync(oldFile, newFile); } catch {}
      }
    }
  } catch {}
  for (const t of TABLES) load(t);
  try { dedupeLiveMessages(); } catch (e) { console.warn("[db] dedupe wa_live_messages falhou", e?.message || e); }
}

// Remove duplicatas existentes na tabela wa_live_messages.
// Regra: se houver source_msg_id, mantém apenas 1 linha por (grupo|source_msg_id).
// Caso contrário, deduplica por (grupo|autor|texto|created_at truncado ao segundo).
function dedupeLiveMessages() {
  const rows = load("wa_live_messages");
  if (!Array.isArray(rows) || rows.length === 0) return;
  const seen = new Set();
  const out = [];
  // Ordena por created_at asc para preservar a primeira ocorrência.
  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(a?.created_at || 0).getTime();
    const tb = new Date(b?.created_at || 0).getTime();
    return ta - tb;
  });
  for (const r of sorted) {
    const grupo = String(r?.grupo || "");
    const src = r?.source_msg_id ? String(r.source_msg_id) : "";
    const ts = String(r?.created_at || "").slice(0, 19);
    const key = src
      ? `s|${grupo}|${src}`
      : `f|${grupo}|${String(r?.autor || "")}|${String(r?.mensagem ?? r?.texto ?? "")}|${ts}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  if (out.length !== rows.length) {
    cache.set("wa_live_messages", out);
    save("wa_live_messages");
    console.log(`[db] wa_live_messages: removidas ${rows.length - out.length} duplicatas (${out.length} restantes).`);
  }
}

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

function applyFilters(rows, filters) {
  return rows.filter((r) => filters.every((f) => {
    const v = r[f.col];
    switch (f.op) {
      case "eq": return v === f.val;
      case "neq": return v !== f.val;
      case "gt": return v > f.val;
      case "gte": return v >= f.val;
      case "lt": return v < f.val;
      case "lte": return v <= f.val;
      case "in": return Array.isArray(f.val) && f.val.includes(v);
      case "is": return f.val === null ? (v === null || v === undefined) : v === f.val;
      case "ilike": {
        const value = String(v ?? "").toLowerCase();
        const pattern = String(f.val ?? "").toLowerCase();
        const raw = pattern.replace(/^%+|%+$/g, "");
        return raw ? value.includes(raw) : value === pattern;
      }
      case "not": {
        if (f.cmp === "is") return f.val === null ? !(v === null || v === undefined) : v !== f.val;
        if (f.cmp === "eq") return v !== f.val;
        return true;
      }
      default: return true;
    }
  }));
}

// op shape: { table, action, payload?, filters?, order?, limit?, single?, onConflict? }
function exec(op) {
  if (!op || !op.table) throw new Error("table required");
  if (!TABLES.includes(op.table)) {
    // auto-register unknown table
    TABLES.push(op.table);
    load(op.table);
  }
  let rows = load(op.table);
  const filters = op.filters || [];

  if (op.action === "select") {
    let result = applyFilters(rows, filters);
    if (op.order) {
      const { col, ascending } = op.order;
      result = [...result].sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * (ascending ? 1 : -1);
      });
    }
    if (typeof op.offset === "number" && op.offset > 0) result = result.slice(op.offset);
    if (op.limit) result = result.slice(0, op.limit);
    if (op.single) return result[0] || null;
    return result;
  }

  if (op.action === "insert") {
    const items = Array.isArray(op.payload) ? op.payload : [op.payload];
    const inserted = items.map((it) => {
      const base = {
        id: it.id || uuid(),
        created_at: it.created_at || now(),
        updated_at: it.updated_at || now(),
        ...it,
      };
      if (op.table === "wa_outbox" && !base.status) base.status = "pending";
      return base;
    });
    rows.push(...inserted);
    save(op.table);
    return op.single ? inserted[0] : inserted;
  }

  if (op.action === "update") {
    const targets = applyFilters(rows, filters);
    for (const t of targets) Object.assign(t, op.payload, { updated_at: now() });
    save(op.table);
    return targets;
  }

  if (op.action === "delete") {
    const keep = [];
    const removed = [];
    for (const r of rows) {
      const matches = applyFilters([r], filters).length > 0;
      if (matches) removed.push(r); else keep.push(r);
    }
    cache.set(op.table, keep);
    save(op.table);
    return removed;
  }

  if (op.action === "upsert") {
    const items = Array.isArray(op.payload) ? op.payload : [op.payload];
    const conflictCols = (op.onConflict || "id").split(",").map((s) => s.trim());
    for (const it of items) {
      const idx = rows.findIndex((r) => conflictCols.every((c) => r[c] === it[c]));
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...it, updated_at: now() };
      } else {
        rows.push({ id: it.id || uuid(), created_at: now(), updated_at: now(), ...it });
      }
    }
    save(op.table);
    return items;
  }

  throw new Error(`Unknown action ${op.action}`);
}

module.exports = { init, exec, load, save, flushAllSync };
