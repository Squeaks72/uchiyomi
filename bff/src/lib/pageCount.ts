// How many pages a chapter file holds, asked of the file itself.
//
// A module of its own for one reason: to keep the answer coming from `cbzPages` and nothing else.
//
// ⚠️ NEVER adm-zip. The one adm-zip in this codebase is write-only (the note at the top of lib/partial.ts,
// pinned by test/zipExtractionGuard.test.ts): it reads a whole archive into memory and has a directory
// traversal history, and the repair's count step walks tens of thousands of archives in one night --
// exactly the shape that turns "a bit wasteful" into a server that swaps. `cbzPages` streams entry
// headers, and it already knows the four other things a chapter can be: a CBR, a folder, a PDF, an EPUB.
import { cbzPages } from './library';

/**
 * Pages in one chapter file, or 0 when it cannot be read.
 *
 * 0 is a real answer here, not an error: the file may be gone (a database restored without its chapters),
 * truncated by a download nobody finished, or an archive of nothing but a ComicInfo. The caller stamps
 * `lib_books.pages_checked_at` either way, which is what stops those files being re-opened every night
 * forever -- see the column note in lib/migrate.ts. Nothing is reported to the source health ledger from
 * here: a file on our own disk says nothing about the site it came from.
 */
export async function countPages(abs: string): Promise<number> {
  return (await countPagesOrNull(abs)) ?? 0;
}

/**
 * Why a read failed, for the stamp: a file that is GONE or a zip that is truly broken is a real 0; anything else (too many open
 * files while the night's count runs wide, a disk hiccup, the mover holding a file) says nothing about the file. Stamping those as
 * 0 left some 13,800 readable chapters on Health's "Chapter files" card for good -- the stamp stops the file being opened again,
 * so a failed read became a permanent finding.
 */
function readFailureMeansZero(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return true;
  return /end of central directory|invalid|corrupt|not a zip|truncat|unexpected|bad (zip|rar|archive)|not an? (archive|zip)/i.test(String((e as Error | null)?.message ?? e));
}

/**
 * Pages in one chapter file, `0` when it is truly unreadable (gone, broken, no images), and `null` when the READ failed for a
 * reason that says nothing about the file: the caller must not stamp anything then, so it is counted again next time. One
 * retry first, after a breath, which is what most such failures need.
 */
export async function countPagesOrNull(abs: string): Promise<number | null> {
  for (let attempt = 0; ; attempt++) {
    try { return (await cbzPages(abs)).length; }
    catch (e) {
      if (readFailureMeansZero(e)) return 0;
      if (attempt >= 1) return null;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
