// "dandadan 213" anywhere a series is searched (2026-11-18): the palette and the Search page. lib/chapterQuery.ts reads the number; this
// finds the series the text before it names, and that chapter of it (GET /api/series/:id/chapter).
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { parseChapterQuery } from './chapterQuery';
import type { Page, Series } from './types';

export interface ChapterHit {
  series: Series;
  number: number;
  /** The chapter on the server, to read; null when only a source lists it (then the series page shows it in its list). */
  bookId: string | null;
  name: string | null;
}

/** The chapter a query asks for, or null when it asks for none, its series is not found, or nothing has that number. */
export async function fetchChapterHit(query: string): Promise<ChapterHit | null> {
  const asked = parseChapterQuery(query);
  if (!asked) return null;
  const found = await api<Page<Series>>('/api/series/search', { json: { query: asked.title, size: 1 } }).catch(() => null);
  const s = found?.content?.[0];
  if (!s) return null;
  const r = await api<{ book: { id: string; number: number; chapterName: string | null } | null; listed: boolean }>(
    `/api/series/${encodeURIComponent(s.id)}/chapter?n=${asked.number}`).catch(() => null);
  return r && (r.book || r.listed) ? { series: s, number: r.book?.number ?? asked.number, bookId: r.book?.id ?? null, name: r.book?.chapterName ?? null } : null;
}

/** The same, as a query keyed by the (already debounced) search text. */
export function useChapterHit(query: string) {
  return useQuery({ queryKey: ['chapter-hit', query], queryFn: () => fetchChapterHit(query), enabled: !!parseChapterQuery(query), staleTime: 60_000 });
}

/** Where each of the two rows goes. */
export const chapterHrefs = (h: ChapterHit) => ({
  read: h.bookId ? `/reader/?book=${h.bookId}` : null,
  show: `/series/?id=${h.series.id}&ch=${h.number}`,
});
