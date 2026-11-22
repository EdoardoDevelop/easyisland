// Searches that forgive typos and word order (22 Nov 2026, Edoardo): uFuzzy
// (a few KB, no dependencies). «certifcato» finds «certificato», «rinnova
// certificato» finds «Certificato da rinnovare». Used after the exact search,
// never instead of it: what matches the words as typed stays on top.

import uFuzzy from "@leeoniya/ufuzzy";

const uf = new uFuzzy({
  // One mistake per word: a letter more, less, swapped or wrong.
  intraMode: 1,
  intraIns: 1,
  intraSub: 1,
  intraTrn: 1,
  intraDel: 1,
});

/** Lower case, no accents. */
const plain = (s: string) => uFuzzy.latinize(s.toLowerCase());

/** Indices of `haystack` that match `needle`, best first (at most `max`). */
export function fuzzyRank(haystack: string[], needle: string, max = 50): number[] {
  const q = plain(needle.trim());
  // Fewer than three letters: every word would match something.
  if (q.replace(/\s+/g, "").length < 3 || !haystack.length) return [];
  try {
    const terms = q.split(/\s+/).filter(Boolean).length;
    const [idxs, info, order] = uf.search(haystack.map(plain), q, Math.min(terms, 3), 1e3);
    if (!idxs?.length) return [];
    const ranked = info && order ? order.map((i) => info.idx[i]) : idxs;
    return ranked.slice(0, max);
  } catch {
    return [];
  }
}

/** `items` that match `needle` (by `text`), best first. */
export function fuzzyFilter<T>(items: T[], text: (item: T) => string, needle: string, max = 50): T[] {
  return fuzzyRank(items.map(text), needle, max).map((i) => items[i]).filter((x): x is T => x !== undefined);
}

/** `exact` first, then the fuzzy matches of `items` not already there (same `key`). */
export function withFuzzy<T>(exact: T[], items: T[], text: (item: T) => string, needle: string, key: (item: T) => string, max = 50): T[] {
  const seen = new Set(exact.map(key));
  const more = fuzzyFilter(items, text, needle, max).filter((x) => !seen.has(key(x)));
  return [...exact, ...more].slice(0, Math.max(max, exact.length));
}
