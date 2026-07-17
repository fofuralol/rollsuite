export function parseBR(value: string): number {
  if (!value) return 0;
  const cleaned = value
    .toString()
    .replace(/R\$\s?/gi, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export function formatBR(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatBRInt(value: number): string {
  const hasCents = value % 1 !== 0;
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
}

export function formatBRL(value: number): string {
  return "R$ " + formatBR(value);
}

export function parseList(text: string): number[] {
  return text
    .split(/[\n\r;\t]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseBR);
}
