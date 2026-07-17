// Drop-in replacement for the Supabase client when running inside Electron.
// Implements just enough of the JS client API for this app to work locally.

type Filter = { col: string; op: string; val: any; cmp?: string };

const FAKE_USER = {
  id: "fofuralol-local",
  email: "fofuralol@local",
  user_metadata: {},
  app_metadata: {},
};
const FAKE_SESSION = { user: FAKE_USER, access_token: "local", refresh_token: "local" };

function api() {
  const w = window as any;
  if (!w.electronAPI) throw new Error("electronAPI ausente — rode dentro do Electron");
  return w.electronAPI;
}

async function runQuery(op: any) {
  const res = await api().dbQuery(op);
  return res; // { data, error }
}

class QueryBuilder {
  private op: any;
  constructor(table: string) {
    this.op = { table, action: "select", filters: [] as Filter[] };
  }
  // selection
  select(_cols?: string, _opts?: any) { this.op.action = "select"; return this; }
  // filters
  eq(col: string, val: any) { this.op.filters.push({ col, op: "eq", val }); return this; }
  neq(col: string, val: any) { this.op.filters.push({ col, op: "neq", val }); return this; }
  gt(col: string, val: any) { this.op.filters.push({ col, op: "gt", val }); return this; }
  gte(col: string, val: any) { this.op.filters.push({ col, op: "gte", val }); return this; }
  lt(col: string, val: any) { this.op.filters.push({ col, op: "lt", val }); return this; }
  lte(col: string, val: any) { this.op.filters.push({ col, op: "lte", val }); return this; }
  in(col: string, val: any[]) { this.op.filters.push({ col, op: "in", val }); return this; }
  is(col: string, val: any) { this.op.filters.push({ col, op: "is", val }); return this; }
  ilike(col: string, val: string) { this.op.filters.push({ col, op: "ilike", val }); return this; }
  not(col: string, cmp: string, val: any) { this.op.filters.push({ col, op: "not", cmp, val }); return this; }
  // modifiers
  order(col: string, opts?: { ascending?: boolean }) {
    this.op.order = { col, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) { this.op.limit = n; return this; }
  range(from: number, to: number) {
    this.op.offset = from;
    this.op.limit = Math.max(0, to - from + 1);
    return this;
  }
  single() { this.op.single = true; return this._exec(); }
  maybeSingle() { this.op.single = true; return this._exec(); }
  // mutations
  insert(payload: any) {
    this.op.action = "insert"; this.op.payload = payload;
    return makeChainable(this.op);
  }
  update(payload: any) {
    this.op.action = "update"; this.op.payload = payload;
    return makeChainable(this.op);
  }
  delete() {
    this.op.action = "delete";
    return makeChainable(this.op);
  }
  upsert(payload: any, opts?: { onConflict?: string }) {
    this.op.action = "upsert"; this.op.payload = payload;
    if (opts?.onConflict) this.op.onConflict = opts.onConflict;
    return this._exec();
  }
  then(onFulfilled?: any, onRejected?: any) {
    return this._exec().then(onFulfilled, onRejected);
  }
  private _exec() { return runQuery(this.op); }
}

// Build a chainable object that supports .eq().lt() etc. AFTER an update/delete/insert
function makeChainable(op: any) {
  const target: any = {
    then(onF: any, onR: any) { return runQuery(op).then(onF, onR); },
  };
  const ops = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "is"];
  for (const m of ops) {
    target[m] = (col: string, val: any) => {
      op.filters = op.filters || [];
      op.filters.push({ col, op: m, val });
      return makeChainable(op);
    };
  }
  target.select = () => makeChainable(op);
  target.single = () => { op.single = true; return runQuery(op); };
  return target;
}

const authStub = {
  async getUser() { return { data: { user: FAKE_USER }, error: null }; },
  async getSession() { return { data: { session: FAKE_SESSION }, error: null }; },
  async getClaims() { return { data: { claims: { sub: FAKE_USER.id } }, error: null }; },
  onAuthStateChange(cb: any) {
    setTimeout(() => cb("SIGNED_IN", FAKE_SESSION), 0);
    return { data: { subscription: { unsubscribe() {} } } };
  },
  async signInWithPassword() { return { data: { user: FAKE_USER, session: FAKE_SESSION }, error: null }; },
  async signUp() { return { data: { user: FAKE_USER, session: FAKE_SESSION }, error: null }; },
  async signOut() { return { error: null }; },
};

const functionsStub = {
  async invoke(name: string, opts?: { body?: any }) {
    const res = await api().fnInvoke(name, opts?.body || {});
    return res;
  },
};

// ---- Realtime bridge ----
type RtHandler = {
  table: string;
  event: string; // "*" | "INSERT" | "UPDATE" | "DELETE"
  filter?: { col: string; val: any } | null;
  cb: (payload: any) => void;
};

const rtChannels = new Set<RealChannel>();
let dbChangeUnsub: null | (() => void) = null;

function parseFilter(f?: string): { col: string; val: any } | null {
  if (!f) return null;
  const m = /^([a-zA-Z0-9_]+)=eq\.(.+)$/.exec(f);
  if (!m) return null;
  return { col: m[1], val: m[2] };
}

function ensureGlobalListener() {
  if (dbChangeUnsub) return;
  const w = window as any;
  if (!w.electronAPI?.onDbChange) return;
  dbChangeUnsub = w.electronAPI.onDbChange((payload: any) => {
    for (const ch of rtChannels) ch._dispatch(payload);
  });
}

class RealChannel {
  private handlers: RtHandler[] = [];
  constructor(public name: string) {}
  on(_type: string, opts: any, cb: (payload: any) => void) {
    this.handlers.push({
      table: opts?.table,
      event: (opts?.event || "*").toUpperCase(),
      filter: parseFilter(opts?.filter),
      cb,
    });
    return this;
  }
  subscribe(cb?: (status: string) => void) {
    rtChannels.add(this);
    ensureGlobalListener();
    try { cb?.("SUBSCRIBED"); } catch {}
    return this;
  }
  unsubscribe() {
    rtChannels.delete(this);
    return Promise.resolve();
  }
  _dispatch(payload: { table: string; eventType: string; new: any; old: any }) {
    for (const h of this.handlers) {
      if (h.table && h.table !== payload.table) continue;
      if (h.event !== "*" && h.event !== payload.eventType) continue;
      if (h.filter) {
        const row = payload.new || payload.old;
        if (!row || String(row[h.filter.col]) !== String(h.filter.val)) continue;
      }
      try { h.cb(payload); } catch {}
    }
  }
}

export const supabase: any = {
  from(table: string) { return new QueryBuilder(table); },
  auth: authStub,
  functions: functionsStub,
  channel: (name: string) => new RealChannel(name),
  removeChannel: (ch: RealChannel) => (ch?.unsubscribe ? ch.unsubscribe() : Promise.resolve()),
};
