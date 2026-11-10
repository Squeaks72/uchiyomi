// The downloader's own file names, in one place. Dependency-free (naming.ts only) so every caller, the SQL-free
// ones and the tests alike, can use it without booting the app's environment.
//
// Two spellings of the same file are "ours":
//   `Chapter 12.cbz`                 the name every file had until the fork put the series in it
//   `Blue Box - Chapter 12.cbz`      the series' folder name, a dash, then the same
// Writing uses the second (chapterFileName); recognising accepts both (isOwnFile, OWN_FILE), and takes ANY
// prefix, so a series moved or renamed after its files were written is still ours. Reintroduce a strict
// comparison and every file written before the change stops being a download of ours: Health, the nightly
// repair, Fetch again and the archive all stop recognising it.
import { posix } from 'node:path';
import { numberByRule } from './naming';

/** A file name read back as the downloader's own, and the number it spells: `Chapter 84.3.cbz`, `X - Chapter -1.cbz`. */
export const OWN_FILE = /^(?:.* - )?Chapter (-?\d+(?:\.\d+)?)\.cbz$/;

/** Longest file name written, in bytes. Filesystems stop at 255; the room left is for ` (2)` and a `.tmp`. */
const MAX_NAME_BYTES = 200;

const legacyName = (number: number): string => `Chapter ${number}.cbz`;

/**
 * SERIES_IN_NAMES=1 (the fork's setting; off is upstream's behaviour exactly): new downloads are named
 * `<Series> - Chapter N.cbz` and carry `<Series> - <chapter>` as their ComicInfo <Title>. Off, every function
 * below that WRITES answers with the plain name; the ones that RECOGNISE a file accept both either way, so
 * turning it on or off never orphans a file.
 */
export const seriesInNames = (): boolean => /^(?:1|true|yes|on)$/i.test(process.env.SERIES_IN_NAMES ?? '');

/**
 * The file name the downloader writes for a chapter of the series in `seriesFolder`.
 *
 * Falls back to the plain `Chapter N.cbz` when the prefixed name would not read back as chapter N (a series whose own
 * title carries a chapter word, "Muramata-san no Aijou Ch. 6", is read by the first marker it finds) or is too long.
 */
export function chapterFileName(seriesFolder: string, number: number, force = false): string {
  if (!force && !seriesInNames()) return legacyName(number);
  const series = posix.basename(seriesFolder).trim();
  const name = series ? `${series} - ${legacyName(number)}` : legacyName(number);
  if (!series || Buffer.byteLength(name) > MAX_NAME_BYTES) return legacyName(number);
  const read = numberByRule(name, 2);
  return read.number === number && read.end === null ? name : legacyName(number);
}

/** Both spellings of the file for a chapter, the one written first. For the places that look one up by path. */
export function chapterFileNames(seriesFolder: string, number: number): string[] {
  return [...new Set([chapterFileName(seriesFolder, number), legacyName(number)])];
}

/** Is `file` (a lib_books.file, `/`-separated) a file of ours for chapter `number` in `seriesFolder`, under either spelling? */
export function isOwnFile(file: string, seriesFolder: string, number: number): boolean {
  if (posix.dirname(file) !== seriesFolder) return false;
  const base = posix.basename(file);
  return base === legacyName(number) || base.endsWith(` - ${legacyName(number)}`);
}

/**
 * The <Title> a chapter's ComicInfo.xml carries: the series, a dash, then what the source called the chapter. A
 * library of single chapters has a book per chapter, and a reader, a file manager or a metadata provider shown only
 * `# 211` cannot tell which series it belongs to. A source title that already starts with the series is left alone.
 */
export function comicTitle(series: string, title: string | undefined | null, number: number, force = false): string {
  const chapter = (title ?? '').trim() || `Chapter ${number}`;
  const s = series.trim();
  if ((!force && !seriesInNames()) || !s || chapter.toLowerCase().startsWith(s.toLowerCase())) return chapter;
  return `${s} - ${chapter}`;
}
