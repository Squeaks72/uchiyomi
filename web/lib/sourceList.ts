// Finding one source in a list of fifty: a name filter and an A to Z / Z to A sort, shared by every list a
// source is picked from (Discover's source sheet, the Library's source filter, "Choose sources" when moving
// a series, the Source order's "add a source"). Pure, so the rules are tested rather than re-derived per list.

/** `default` is the list's own order: priority on Discover, series count in the Library, install order elsewhere. */
export type SourceSort = 'default' | 'az' | 'za';

/** Below this many rows a search box and a sort are clutter; the list is short enough to read. */
export const SOURCE_TOOLS_MIN = 8;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);

/** Rows whose name contains every word of `query`, ignoring case and accents. A blank query keeps them all. */
export function filterSources<T extends { name: string }>(list: T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((s) => { const n = fold(s.name); return words.every((w) => n.includes(w)); });
}

/** A copy in the chosen order. `default` returns the list as given: the caller's order is the meaning. */
export function sortSources<T extends { name: string; id: string }>(list: T[], by: SourceSort): T[] {
  if (by === 'default') return list;
  const out = [...list].sort(byName);
  return by === 'za' ? out.reverse() : out;
}

/** Filter, then sort. */
export function arrangeSources<T extends { name: string; id: string }>(list: T[], query: string, by: SourceSort): T[] {
  return sortSources(filterSources(list, query), by);
}
