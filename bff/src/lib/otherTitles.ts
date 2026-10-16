// The English, romanised and Japanese titles of a series, from the AniList entry it is linked to (series_trackers).
// Asked once and kept (series_other_titles); an answer with names is refreshed after a month, an empty one after a day.
// A series with no AniList link has none to show and costs no request.
import { one, q } from './db';

const ANILIST = (process.env.ANILIST_API_URL || 'https://graphql.anilist.co').replace(/\/+$/, '');
const DAY = 24 * 60 * 60 * 1000;

export interface OtherTitles { english: string | null; romaji: string | null; native: string | null }

export async function otherTitlesFor(seriesId: string): Promise<OtherTitles | null> {
  const have = await one<OtherTitles & { age: string }>(
    'SELECT english, romaji, native, EXTRACT(EPOCH FROM now() - fetched_at) * 1000 AS age FROM series_other_titles WHERE series_id = $1', [seriesId]);
  const named = !!(have && (have.english || have.romaji || have.native));
  if (have && Number(have.age) < (named ? 30 * DAY : DAY)) return named ? { english: have.english, romaji: have.romaji, native: have.native } : null;
  const link = await one<{ external_id: string }>(
    `SELECT external_id FROM series_trackers WHERE series_id = $1 AND provider = 'anilist'`, [seriesId]);
  const id = Number(link?.external_id);
  if (!Number.isInteger(id) || id <= 0) return named ? { english: have!.english, romaji: have!.romaji, native: have!.native } : null;
  try {
    const r = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: 'query($id:Int){Media(id:$id,type:MANGA){title{romaji english native}}}', variables: { id } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return named ? { english: have!.english, romaji: have!.romaji, native: have!.native } : null;
    const t = ((await r.json()) as any)?.data?.Media?.title ?? {};
    const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const out: OtherTitles = { english: pick(t.english), romaji: pick(t.romaji), native: pick(t.native) };
    await q(`INSERT INTO series_other_titles (series_id, english, romaji, native) VALUES ($1, $2, $3, $4)
             ON CONFLICT (series_id) DO UPDATE SET english = $2, romaji = $3, native = $4, fetched_at = now()`,
      [seriesId, out.english, out.romaji, out.native]);
    return out.english || out.romaji || out.native ? out : null;
  } catch {
    return named ? { english: have!.english, romaji: have!.romaji, native: have!.native } : null;
  }
}
