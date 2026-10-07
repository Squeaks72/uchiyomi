// Titles an admin has marked 18+ from a card's menu on Discover (the `adult_titles` table).
//
// A Discover listing is a source's row, not a library row: it has no series id, so there is nothing to put an age
// rating on. The one thing every copy of it shares is its title, so the mark is on the folded title. It joins the other
// 18+ signals in searchAll.ratingOf (so a search, a source's newest and its popular list all drop it while the
// viewer is hiding 18+) and is applied to the trending and recommendation rows by the routes that serve them.
import { q } from './db';

/** A title folded for comparison: case, accents, spacing and punctuation gone, any script's letters and digits kept. */
export function titleKey(title: string): string {
  return String(title ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Mark (or, with `adult` false, unmark) a title. Returns whether anything changed. */
export async function setAdultTitle(title: string, adult: boolean, by: string | null): Promise<boolean> {
  const key = titleKey(title);
  if (!key) return false;
  if (adult) {
    const r = await q('INSERT INTO adult_titles (key, title, marked_by) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING RETURNING key', [key, title.trim().slice(0, 300), by]);
    return r.length > 0;
  }
  const r = await q('DELETE FROM adult_titles WHERE key = $1 RETURNING key', [key]);
  return r.length > 0;
}

export async function listAdultTitles(): Promise<Array<{ key: string; title: string }>> {
  return q<{ key: string; title: string }>('SELECT key, title FROM adult_titles ORDER BY marked_at DESC LIMIT 5000');
}
