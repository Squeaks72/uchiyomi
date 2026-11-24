// Starred chapters (fork, 2026-11-24): "the whole of this chapter was worth keeping", one account's, private.
//
// A star is the bookmark of page 0 (bff routes/personal.ts): real pages start at 1, and riding the bookmarks table
// means a star follows its chapter through every merge, rescan and copy fold a page bookmark already survives, and
// keeps the chapter from the read-chapter cleanup as a bookmark does. `GET /api/bookmarks` leaves page 0 out unless it
// is asked for (`kind=chapter` or `kind=all`), so a client written before the stars never offers a "page 0".
//
// The series page asks for one series' stars here; Moments lists them with the saved pages (kind=all), and the reader folds them into
// the page marks it already holds (kind=all). All three invalidate ['chapterStars'] after a change.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { t as tr } from '@/lib/i18n';

/** The page a chapter star is filed under. */
export const STAR_PAGE = 0;

export const starPath = (bookId: string) => `/api/bookmarks/${encodeURIComponent(bookId)}/${STAR_PAGE}`;

/** One series' starred chapters for this account, and a switch for one of them (optimistic, reverted on failure). */
export function useChapterStars(seriesId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['chapterStars', seriesId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api<{ content: Array<{ book_id: string }> }>(`/api/bookmarks?seriesId=${encodeURIComponent(seriesId)}&kind=chapter`),
    enabled: !!seriesId,
    select: (r) => new Set(r.content.map((b) => b.book_id)),
  });
  const stars = data ?? new Set<string>();
  const toggle = async (bookId: string) => {
    const on = stars.has(bookId);
    const flip = (has: boolean) => qc.setQueryData<{ content: Array<{ book_id: string }> }>(key, (old) => {
      const rest = (old?.content ?? []).filter((b) => b.book_id !== bookId);
      return { content: has ? [{ book_id: bookId }, ...rest] : rest };
    });
    flip(!on);
    try {
      await api(starPath(bookId), { method: on ? 'DELETE' : 'PUT', json: on ? undefined : {} });
      toast(on ? tr('Star removed') : tr('Chapter starred'));
    } catch {
      flip(on);
      toast(tr('Could not change the star'), 'error');
    }
    void qc.invalidateQueries({ queryKey: ['chapterStars'] });
    void qc.invalidateQueries({ queryKey: ['bookmarks'] });
  };
  return { stars, toggle };
}
