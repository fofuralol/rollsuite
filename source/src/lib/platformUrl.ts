// Normaliza um "nome_ciclo" (que é geralmente uma URL) pra agrupar variações
// equivalentes. Mantém o host + primeiro path significativo quando possível.
export function normalizeUrl(raw: string): string {
  if (!raw) return "";
  let s = String(raw).trim().toLowerCase();
  // remove protocolo e www
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  // remove query/hash
  s = s.split("?")[0].split("#")[0];
  // remove barra final
  s = s.replace(/\/+$/, "");
  // remove espaços internos acidentais
  s = s.replace(/\s+/g, "");
  return s;
}

// Extrai apenas o host (útil pra agrupar /promo, /cadastro etc. na mesma URL base)
export function extractHost(raw: string): string {
  const norm = normalizeUrl(raw);
  if (!norm) return "";
  return norm.split("/")[0];
}

// Domínio-base ("eTLD+1" simplificado): últimos 2 rótulos do host, salvo se
// o penúltimo for um sufixo de país-2ª-camada comum (com.br, co.uk, etc.),
// aí pega os últimos 3. Ex.:
//   w1.onde.com    -> onde.com
//   onde.com       -> onde.com
//   foo.bar.co.uk  -> bar.co.uk
//   sub.site.com.br-> site.com.br
export function extractBaseDomain(raw: string): string {
  const host = extractHost(raw);
  if (!host) return "";
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoLevelSuffixes = new Set([
    "com.br", "com.ar", "com.mx", "com.co", "com.pe", "com.uy",
    "co.uk", "co.jp", "co.kr", "co.in", "co.za", "co.nz",
    "org.br", "net.br", "gov.br", "edu.br",
  ]);
  const lastTwo = parts.slice(-2).join(".");
  if (twoLevelSuffixes.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

// SLD ("segundo-nível") — o rótulo antes do TLD/eTLD. Serve pra tratar
// onde.com / onde.co / onde.cc / w1.onde.com todos como "onde".
export function extractSld(raw: string): string {
  const base = extractBaseDomain(raw);
  if (!base) return "";
  const parts = base.split(".");
  // base pode ser "onde.com" (2), "site.com.br" (3), "bar.co.uk" (3)
  // o SLD é o primeiro rótulo do base
  return parts[0] || "";
}

// Extrai um "keyword" alfanumérico inicial do SLD, ex.:
//   okokbhd2   -> "okok" (se o keyword conhecido for "okok")
// Retorna o SLD completo em lowercase; o matching por prefixo é feito no consumidor.
export function extractSldLower(raw: string): string {
  return extractSld(raw).toLowerCase();
}

