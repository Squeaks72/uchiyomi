// The language a person wants their series titles in (account setting `titleLang`).
//
// A series is stored once per language edition (lib/editions.ts): "Blue Lock" and "ブルーロック" are two rows of one
// work, each with its own title. The Library shows one card per work, and which edition's card it shows is what decides
// the title on it. With no preference that is the one the viewer read last, else the oldest. With a preference the
// edition in that language comes first, then one in the same base language ("es" for "es-419"), then the old rule --
// so a work with no edition in the language still shows, under whatever title it has. Nothing is hidden by this.
import { q, one } from './db';
import { baseLang, canonLang } from './lang';

/** The viewer's preferred title language as an app code, or null for no preference (and for anything unreadable). */
export async function preferredTitleLang(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const row = await one<{ v: string | null }>(`SELECT data->>'titleLang' AS v FROM app_settings WHERE user_id = $1`, [userId])
    .catch(() => null);
  return canonLang(row?.v);
}

/**
 * Every language a live series on this server is in, as stated app codes. Only series that belong to a work state
 * their language (every row in a work does), so these are the languages a title can actually be switched to.
 */
export async function titleLanguages(): Promise<string[]> {
  const rows = await q<{ lang: string }>(
    `SELECT DISTINCT lang FROM lib_series
      WHERE work_id IS NOT NULL AND lang IS NOT NULL AND deleted_at IS NULL AND merged_into IS NULL`);
  return [...new Set(rows.map((r) => canonLang(r.lang)).filter((l): l is string => !!l))].sort();
}

/** The SQL ordering term that puts the editions in `lang` first; `''` when there is no preference. */
export function titleLangOrder(lang: string | null, add: (v: unknown) => string, col = 'sv.lang'): string {
  if (!lang) return '';
  const exact = add(lang);
  const base = add(baseLang(lang) ?? lang);
  return `(CASE WHEN ${col} = ${exact} THEN 0 WHEN split_part(${col}, '-', 1) = ${base} THEN 1 ELSE 2 END), `;
}
