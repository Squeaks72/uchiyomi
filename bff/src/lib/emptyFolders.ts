// Nightly tidy-up: remove folders that are empty, the remnants of series that moved or were deleted.
//
// Deliberately timid, because it deletes under the library roots:
//   - only `rmdir`, which the OS refuses for anything that holds even one file, so no file can be lost here;
//   - never a root itself, a folder a library is configured on, or a folder a series row still points at (a series
//     added moments ago has its folder before its first chapter lands);
//   - never a symlink, a hidden/system folder (`.x`, `#recycle`, `@eaDir`), or one touched in the last hour (a
//     download may be about to write into it);
//   - a root that cannot be read is skipped whole.
import { readdir, rmdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { q } from './db';
import { DL_ROOT, LIBRARY_ROOT } from './library';

const RECENT_MS = 60 * 60 * 1000;
const SKIP = /^[.#@]/;

export async function removeEmptyFolders(log?: { info: (m: string) => void; warn: (m: string) => void }): Promise<{ removed: string[] }> {
  const keep = new Set<string>();
  for (const r of await q<{ p: string }>(
    `SELECT path AS p FROM library_paths UNION SELECT path FROM libraries WHERE path <> '' UNION SELECT folder FROM lib_series`)) {
    if (r.p) keep.add(r.p.replace(/^\/+|\/+$/g, ''));
  }
  const { removed } = await sweepEmptyFolders([...new Set([LIBRARY_ROOT, DL_ROOT])], keep);
  if (removed.length) log?.info(`empty folders: removed ${removed.length}`);
  return { removed };
}

/** The walk itself, given the roots and the relative folders to keep. */
export async function sweepEmptyFolders(roots: string[], keep: Set<string>, recentMs = RECENT_MS): Promise<{ removed: string[] }> {
  const removed: string[] = [];

  const walk = async (root: string, dir: string): Promise<boolean> => {
    // Returns true when `dir` is empty after its children were tidied (so the parent may be removable too).
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return false; }
    let left = entries.length;
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink() || SKIP.test(e.name)) continue;
      if (await walk(root, join(dir, e.name))) left--;
    }
    if (left > 0 || dir === root) return false;
    const rel = relative(root, dir).split('\\').join('/');
    if (keep.has(rel)) return false;
    try {
      const st = await stat(dir);
      if (Date.now() - st.mtimeMs < recentMs) return false;
      await rmdir(dir);
      removed.push(dir);
      return true;
    } catch { return false; }
  };

  for (const root of roots) {
    if (!(await stat(root).then((s) => s.isDirectory()).catch(() => false))) continue;
    await walk(root, root);
  }
  return { removed };
}
