/** Splits a query into highlightable terms (whitespace-separated, CJK-safe). */
export function queryTerms(query: string, maxTerms = 50): string[] {
  const phrase = query.trim();
  const terms = phrase
    .split(/[\s,;、，；|/\\]+/)
    .map((term) => term.replace(/^["'`([{]+|["'`)\]}:.!?。、，！？；：~*_#>]+$/g, ''))
    .filter((term) => term.length > 0 && term.length <= 100);
  const unique = [...new Set(terms)];
  if (unique.length === 0 && phrase.length > 0) unique.push(phrase.slice(0, 100));
  return unique.slice(0, maxTerms);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function basenameWithoutExtension(path: string): string {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function normalizeVaultPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}
