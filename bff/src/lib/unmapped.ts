// Files in the downloads folder the library does not hold, and what an admin may do about them (Admin → Library).
//
// lib/downloadCensus.ts already COUNTS chapter files the scan did not index; this lists everything under the downloads
// folder that is not a library chapter, and acts on it:
//   - chapter archives (cbz/cbr/zip/rar/pdf) can be MAPPED to a series, which moves the file into the series' folder as
//     `Chapter N.<ext>` -- the name the downloader and the scan already use;
//   - anything else ("other files": stray images, .txt, .nfo, someone's EPUB) can only be DELETED, and so can an archive.
//
// ⚠️ DELETE NEVER UNLINKS. A file goes to `<downloads>/.recycle/` (a dot folder, which no scan, census or empty-folder
// sweep looks into) with a row in `unmapped_recycle`; it is restorable until `server_settings.unmapped_recycle_days` has
// passed, and only then does `purgeExpiredRecycle` remove it. A file that is a library chapter (a lib_books row, or inside
// a chapter that is a folder) is refused by name, whatever the caller asked: the library's own files are never this
// feature's to move. Reintroduce by dropping the `isLibraryFile` check in `recycleFiles`: unmapped.test.ts finds a chapter recycled.
import { mkdir, rename, stat, lstat, copyFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import { basename, dirname, extname, posix, join } from 'path';
import { q, one } from './db';
import { DL_ROOT, SKIP_DIR, listDir, nodeFs } from './library';
import { containedPath } from './fsGuard';
import { setAsideByRoot } from './setAside';

/** What the scan reads as a chapter archive. EPUBs are not: a novel is not a chapter, so it is an "other file". */
export const ARCHIVE_EXT = /\.(cbz|cbr|zip|rar|pdf)$/i;
export const RECYCLE_DIR = '.recycle';
/** A file touched this recently may still be being written, or may be waiting for the scan's next pass. */
export const RECENT_MS = 10 * 60_000;
const MAX_DEPTH = 12;
const MAX_ENTRIES = 200_000;

export interface UnmappedFile {
  /** Relative to the downloads folder, posix. */
  path: string;
  name: string;
  size: number;
  mtime: number;
  kind: 'archive' | 'other';
  /** The chapter number the name suggests (archives only); null when it suggests none. */
  guess: number | null;
}
export interface UnmappedGroup {
  /** The folder the files sit in, relative to the downloads folder; '' is the folder itself. */
  folder: string;
  files: UnmappedFile[];
  /** A series whose title or folder name is this folder's name: the likeliest place to map it. */
  suggest?: { id: string; title: string; folder: string };
}
export interface UnmappedListing {
  groups: UnmappedGroup[];
  files: number;
  archives: number;
  bytes: number;
  /** Stopped at the entry cap: the lists are a floor. */
  truncated: boolean;
}

/**
 * The chapter number a file name suggests, or null. `Chapter 12.5.cbz`, `Ch.12`, `c012`, `#12`, `ep 12`, `Title 012`,
 * `Title - 012 (Digital) [Group]`. A volume number (`v03`, `Vol. 3`) is never a chapter, and a number inside brackets
 * or a year-like four digits after a space is skipped. The UI shows the guess for correction, so a miss is cheap and a
 * wrong hit is fixed by the admin before anything moves.
 */
export function guessChapterNumber(name: string): number | null {
  let s = name.replace(/\.[A-Za-z0-9]{2,4}$/, '');
  s = s.replace(/[\[(][^\])]*[\])]/g, ' ');                       // (Digital) [Group] (2019)
  s = s.replace(/\b(?:vol(?:ume)?|v)\.?\s*\d+(?:\.\d+)?\b/gi, ' '); // volume numbers
  const labelled = s.match(/(?:^|[^a-z])(?:chapter|chap|ch|c|episode|ep|#)\.?\s*(-?\d+(?:\.\d+)?)/i);
  if (labelled) return Number(labelled[1]);
  const all = [...s.matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)(?![\w])/g)].map((m) => m[1]).filter((n) => !/^(19|20)\d\d$/.test(n));
  return all.length ? Number(all[all.length - 1]) : null;
}

/** The name a mapped file takes: the downloader's own (`Chapter 84.3.cbz`), keeping a non-cbz extension as it is. */
export function chapterFileName(number: number, ext: string): string {
  return `Chapter ${number}${ext.toLowerCase()}`;
}

/** Folder names compare without case, punctuation or spacing: `One Piece`, `one-piece` and `ONE_PIECE` are one. */
const squash = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export async function listUnmapped(): Promise<UnmappedListing> {
  const known = new Set((await q<{ file: string }>('SELECT file FROM lib_books WHERE root = $1', [DL_ROOT])).map((r) => r.file));
  const aside = (await setAsideByRoot()).get(DL_ROOT) ?? new Map();
  const byFolder = new Map<string, UnmappedFile[]>();
  let seen = 0;
  let truncated = false;
  const now = Date.now();

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    const { entries } = await listDir(rel ? join(DL_ROOT, rel) : DL_ROOT, nodeFs);
    for (const e of entries) {
      if (++seen > MAX_ENTRIES) { truncated = true; return; }
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.kind === 'dir') {
        // A chapter that is a folder of page images is a library book: its pages are not stray files.
        if (SKIP_DIR.test(e.name) || known.has(child)) continue;
        await walk(child, depth + 1);
      } else if (e.kind === 'file') {
        if (known.has(child) || aside.has(child) || e.name.startsWith('.')) continue;
        const st = await stat(join(DL_ROOT, child)).catch(() => null);
        if (!st || now - st.mtimeMs < RECENT_MS) continue;
        const kind = ARCHIVE_EXT.test(e.name) ? 'archive' : 'other';
        const f: UnmappedFile = { path: child, name: e.name, size: st.size, mtime: Math.floor(st.mtimeMs), kind, guess: kind === 'archive' ? guessChapterNumber(e.name) : null };
        const list = byFolder.get(rel);
        if (list) list.push(f); else byFolder.set(rel, [f]);
      }
    }
  };
  await walk('', 0);

  const series = await q<{ id: string; title: string; folder: string }>(
    'SELECT id, title, folder FROM lib_series WHERE deleted_at IS NULL AND merged_into IS NULL');
  const bySquash = new Map<string, { id: string; title: string; folder: string }>();
  for (const s of series) {
    for (const k of [squash(s.title), squash(posix.basename(s.folder))]) if (k && !bySquash.has(k)) bySquash.set(k, s);
  }

  const groups: UnmappedGroup[] = [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, files]) => {
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const hit = folder ? bySquash.get(squash(posix.basename(folder))) : undefined;
      return { folder, files, ...(hit ? { suggest: hit } : {}) };
    });
  const all = groups.flatMap((g) => g.files);
  return {
    groups, files: all.length, archives: all.filter((f) => f.kind === 'archive').length,
    bytes: all.reduce((n, f) => n + f.size, 0), truncated,
  };
}

/** Is this relative path a file the library holds, or inside a folder-chapter it holds? */
async function isLibraryFile(rel: string): Promise<boolean> {
  const parts = rel.split('/');
  const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  return !!(await one('SELECT 1 FROM lib_books WHERE root = $1 AND file = ANY($2) LIMIT 1', [DL_ROOT, prefixes]));
}

/** Moves a file, falling back to copy + unlink across filesystems. Never overwrites. */
async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await copyFile(from, to, 1 /* COPYFILE_EXCL */);
    await unlink(from);
  }
}

export interface ItemResult { path: string; ok: boolean; reason?: string; to?: string }

/**
 * Moves chapter archives into `folderRel` (a series folder, relative to the downloads folder) as `Chapter N.<ext>`.
 * Each item succeeds or is refused on its own: a number taken by another file in the batch or by an existing chapter,
 * a file that is no longer there, one that is not an archive, one that is a library chapter. Nothing is overwritten.
 */
export async function mapFiles(folderRel: string, items: Array<{ path: string; number: number }>): Promise<ItemResult[]> {
  const out: ItemResult[] = [];
  const destDir = containedPath(DL_ROOT, folderRel);
  if (!destDir) return items.map((i) => ({ path: i.path, ok: false, reason: 'That folder is not inside the downloads folder.' }));
  const taken = new Set((await q<{ file: string }>('SELECT file FROM lib_books WHERE root = $1 AND file LIKE $2', [DL_ROOT, `${folderRel}/%`])).map((r) => r.file.toLowerCase()));
  for (const it of items) {
    const refuse = (reason: string) => out.push({ path: it.path, ok: false, reason });
    const from = containedPath(DL_ROOT, it.path);
    if (!from) { refuse('That file is not inside the downloads folder.'); continue; }
    if (!ARCHIVE_EXT.test(it.path)) { refuse('Only chapter archives can be mapped to a series.'); continue; }
    if (!Number.isFinite(it.number)) { refuse('Give it a chapter number.'); continue; }
    if (await isLibraryFile(it.path)) { refuse('That file is already a chapter of the library.'); continue; }
    const st = await lstat(from).catch(() => null);
    if (!st || !st.isFile()) { refuse('That file is gone.'); continue; }
    const rel = posix.join(folderRel, chapterFileName(it.number, extname(it.path)));
    const to = containedPath(DL_ROOT, rel)!;
    // Any extension counts: Chapter 5.cbz and Chapter 5.zip are one chapter, and the scan would list it twice.
    const stem = rel.replace(/\.[^./]+$/, '').toLowerCase();
    const clash = [...taken].some((t) => t.replace(/\.[^./]+$/, '') === stem);
    if (clash || await stat(to).then(() => true, () => false)) { refuse(`Chapter ${it.number} is already in that series.`); continue; }
    if (from === to) { refuse('It is already there.'); continue; }
    try {
      await moveFile(from, to);
      taken.add(rel.toLowerCase());
      out.push({ path: it.path, ok: true, to: rel });
    } catch (e) {
      refuse(`Could not move it: ${(e as Error).message}`);
    }
  }
  return out;
}

// ---- the bin ----------------------------------------------------------------------------------------------------

export interface RecycledRow { id: string; orig: string; size: number; deleted_at: string; expires_at: string }

export async function recycleDays(): Promise<number> {
  const r = await one<{ d: number }>('SELECT unmapped_recycle_days AS d FROM server_settings WHERE id = 1').catch(() => null);
  const d = Number(r?.d);
  return Number.isInteger(d) && d >= 1 && d <= 365 ? d : 14;
}

/** Moves files into the bin. Refuses a library chapter, a missing file and a non-file; each item stands alone. */
export async function recycleFiles(paths: string[], by: string | null): Promise<ItemResult[]> {
  const out: ItemResult[] = [];
  for (const p of paths) {
    const refuse = (reason: string) => out.push({ path: p, ok: false, reason });
    const from = containedPath(DL_ROOT, p);
    if (!from || p.split('/').some((s) => SKIP_DIR.test(s))) { refuse('That file is not inside the downloads folder.'); continue; }
    if (await isLibraryFile(p)) { refuse('That file is a chapter of the library.'); continue; }
    const st = await lstat(from).catch(() => null);
    if (!st || !st.isFile()) { refuse('That file is gone.'); continue; }
    const id = randomUUID();
    const stored = posix.join(RECYCLE_DIR, `${id}-${basename(p)}`);
    try {
      await moveFile(from, join(DL_ROOT, stored));
      await q('INSERT INTO unmapped_recycle (id, orig, stored, size, by_user) VALUES ($1,$2,$3,$4,$5)', [id, p, stored, st.size, by]);
      out.push({ path: p, ok: true });
    } catch (e) {
      refuse(`Could not move it to the bin: ${(e as Error).message}`);
    }
  }
  return out;
}

export async function listRecycled(): Promise<{ days: number; rows: RecycledRow[]; bytes: number }> {
  const days = await recycleDays();
  const rows = await q<RecycledRow>(
    `SELECT id, orig, size::float8 AS size, deleted_at, deleted_at + ($1 || ' days')::interval AS expires_at
       FROM unmapped_recycle ORDER BY deleted_at DESC LIMIT 1000`, [String(days)]);
  return { days, rows, bytes: rows.reduce((n, r) => n + Number(r.size), 0) };
}

/** Puts files back where they were. Refuses when something is there now. */
export async function restoreRecycled(ids: string[]): Promise<ItemResult[]> {
  const out: ItemResult[] = [];
  for (const id of ids) {
    const r = await one<{ orig: string; stored: string }>('SELECT orig, stored FROM unmapped_recycle WHERE id = $1', [id]);
    if (!r) { out.push({ path: id, ok: false, reason: 'It is no longer in the bin.' }); continue; }
    const from = containedPath(DL_ROOT, r.stored);
    const to = containedPath(DL_ROOT, r.orig);
    if (!from || !to) { out.push({ path: r.orig, ok: false, reason: 'Its place is not inside the downloads folder.' }); continue; }
    if (await stat(to).then(() => true, () => false)) { out.push({ path: r.orig, ok: false, reason: 'Something is already at its old place.' }); continue; }
    try {
      if (await stat(from).then(() => true, () => false)) await moveFile(from, to);
      await q('DELETE FROM unmapped_recycle WHERE id = $1', [id]);
      out.push({ path: r.orig, ok: true });
    } catch (e) {
      out.push({ path: r.orig, ok: false, reason: `Could not put it back: ${(e as Error).message}` });
    }
  }
  return out;
}

/** Removes binned files for good: those past the time limit, or exactly the ids asked for. Returns how many went. */
export async function purgeRecycled(only?: string[]): Promise<number> {
  const days = await recycleDays();
  const rows = only
    ? await q<{ id: string; stored: string }>('SELECT id, stored FROM unmapped_recycle WHERE id = ANY($1)', [only])
    : await q<{ id: string; stored: string }>(`SELECT id, stored FROM unmapped_recycle WHERE deleted_at < now() - ($1 || ' days')::interval`, [String(days)]);
  let n = 0;
  for (const r of rows) {
    const abs = containedPath(DL_ROOT, r.stored);
    if (abs && r.stored.startsWith(`${RECYCLE_DIR}/`)) {
      try { await unlink(abs); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') continue; }
    }
    await q('DELETE FROM unmapped_recycle WHERE id = $1', [r.id]);
    n++;
  }
  return n;
}
