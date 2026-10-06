import type { QueryClient } from '@tanstack/react-query';

/** Returns `data` with every series `id` that carries a `yomi` block marked (un)favorited; untouched branches keep their identity. */
export function withFavorite<T>(data: T, id: string, favorite: boolean): T {
  if (Array.isArray(data)) {
    let out: unknown[] | null = null;
    data.forEach((v, i) => {
      const n = withFavorite(v, id, favorite);
      if (n !== v) { out ??= data.slice(); out[i] = n; }
    });
    return (out ?? data) as T;
  }
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    let out: Record<string, unknown> | null = null;
    for (const k of Object.keys(o)) {
      const v = o[k];
      let n = v;
      if (k === 'yomi' && o.id === id && v && typeof v === 'object' && (v as { favorite?: boolean }).favorite !== favorite) n = { ...(v as object), favorite };
      else if (v && typeof v === 'object') n = withFavorite(v, id, favorite);
      if (n !== v) { out ??= { ...o }; out[k] = n; }
    }
    return (out ?? data) as T;
  }
  return data;
}

/** Makes a favourite change show everywhere a cached card for the series is drawn, before any refetch lands. */
export function applyFavorite(qc: QueryClient, id: string, favorite: boolean) {
  qc.setQueriesData({ predicate: (q) => q.queryKey[0] !== 'favorite-ids' }, (old: unknown) => (old === undefined ? old : withFavorite(old, id, favorite)));
  qc.setQueryData<string[]>(['favorite-ids'], (old) => {
    if (!old) return old;
    const rest = old.filter((x) => x !== id);
    return favorite ? [...rest, id] : rest;
  });
}
