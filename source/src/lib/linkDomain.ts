// Extracts the "site identifier" from a URL/link.
// Ex.: "https://okokteam1.com/?id=908283972" -> "okokteam1"
//      "http://www.foo.bar.co.uk/x"           -> "foo" (best-effort: first label after stripping www)
//      "okokteam1"                            -> "okokteam1"
export function extractLinkDomainKey(link: string | null | undefined): string {
  if (!link) return "";
  let s = String(link).trim().toLowerCase();
  if (!s) return "";
  // strip protocol
  s = s.replace(/^[a-z][a-z0-9+\-.]*:\/\//, "");
  // strip path/query/hash
  s = s.split("/")[0].split("?")[0].split("#")[0];
  // strip leading www.
  s = s.replace(/^www\./, "");
  // take first label (before first dot) as the site key
  const first = s.split(".")[0];
  return (first || "").trim();
}
