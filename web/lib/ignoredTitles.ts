import { useCallback } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** A title folded for comparison: case, accents, spacing and punctuation gone, any script's letters and digits kept. The server's `titleKey` (routes/personal.ts) folds the same way. */
export function titleKey(title: string): string {
  return String(title ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Ignore (or stop ignoring) a title that is not in the library. The card leaves the screen at once -- the cached key
 * set is updated first -- and is put back if the server refuses.
 */
export async function setTitleIgnored(qc: QueryClient, title: string, ignored: boolean): Promise<void> {
  const before = qc.getQueryData<Set<string>>(['ignored-titles']);
  const next = new Set(before ?? []);
  if (ignored) next.add(titleKey(title)); else next.delete(titleKey(title));
  qc.setQueryData(['ignored-titles'], next);
  try {
    await api('/api/ignored-titles', { method: 'PUT', json: { title, ignored } });
  } catch (e) {
    qc.setQueryData(['ignored-titles'], before);
    throw e;
  }
  qc.invalidateQueries({ queryKey: ['ignored-titles-list'] });
}

/** The folded keys of the titles this person ignored (Discover's "Ignore"); the profile lists them to take back. */
export function useIgnoredKeys(): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: ['ignored-titles'], staleTime: 300_000,
    queryFn: () => api<{ content: Array<{ key: string }> }>('/api/ignored-titles').then((r) => new Set(r.content.map((m) => m.key))),
  });
  return data ?? EMPTY;
}
const EMPTY: ReadonlySet<string> = new Set();

/** Whether a title should be left off the screen now: ignored, and not a library series (a card given a series id is one that is, and stays). */
export function useIsHiddenTitle(): (title: string, seriesId?: string) => boolean {
  const ignored = useIgnoredKeys();
  return useCallback((title: string, seriesId?: string) => !seriesId && ignored.has(titleKey(title)), [ignored]);
}
