// Health: "Folder permissions" -- series folders the server cannot write to.
//
// A rename, a move to another library, a merge or a download into a folder the server may not write fails with EACCES,
// and the first anyone hears of it is a toast partway through a bulk move ("4 folders could not be moved: permission
// denied, rename ..."). The usual cause is a folder made by a root shell (or another container with another user) beside
// Uchiyomi's own: owned by root, no group write. This looks for them before they bite.
//
// One `access(W_OK)` per series folder (and its parent, and the root): the answer the kernel gives THIS process, so a
// folder that is fine for the owner but not for the server is found, and an odd share (ACLs, FUSE) is judged by what it
// really allows. No file is opened and nothing is written. The fix is a command to run on the host: Uchiyomi cannot
// chown what it cannot write, and says so with the numbers (who owns it, who the server is).
import { access, stat } from 'fs/promises';
import { constants } from 'fs';
import { dirname, join } from 'path';
import { q } from './db';
import { visibleToAll } from './visibility';
import { DL_ROOT } from './library';
import { applyIgnores, noIgnores, type IgnoreCtx } from './healthIgnore';
import { hiddenPart, ignoredPart, truncate, verdict, withAll } from './healthKit';
import { detailOf, noteOf, say, summaryOf } from './said';
import type { HealthCheck, HealthItem } from './health';

const modeOf = (m: number) => (m & 0o7777).toString(8).padStart(4, '0');
const canWrite = (p: string) => access(p, constants.W_OK | constants.X_OK).then(() => true, (e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? null : false));

export interface FolderFinding { folder: string; owner: string; mode: string; series: number }

/** The folders under the downloads root the server cannot write to, worst (most series) first. */
export async function unwritableFolders(root = DL_ROOT): Promise<{ root: boolean; rows: FolderFinding[] }> {
  const rootOk = await canWrite(root);
  const series = await q<{ folder: string }>(`SELECT folder FROM lib_series ls WHERE ${visibleToAll('ls')}`).catch(() => [] as { folder: string }[]);
  const counts = new Map<string, number>();
  for (const s of series) {
    const rel = s.folder.replace(/^\/+|\/+$/g, '');
    if (!rel) continue;
    // The series folder and each folder above it down to the root: a library folder that is not writable stops every move into it.
    for (let d = rel; d && d !== '.'; d = dirname(d)) counts.set(d, (counts.get(d) ?? 0) + (d === rel ? 1 : 0));
  }
  const bad: FolderFinding[] = [];
  const names = [...counts.keys()];
  for (let i = 0; i < names.length; i += 40) {
    await Promise.all(names.slice(i, i + 40).map(async (rel) => {
      const abs = join(root, rel);
      if ((await canWrite(abs)) !== false) return;
      const st = await stat(abs).catch(() => null);
      bad.push({ folder: rel, owner: st ? `${st.uid}:${st.gid}` : '?', mode: st ? modeOf(st.mode) : '?', series: 0 });
    }));
  }
  // How many series sit under each bad folder, so the worst is first and the row says what it blocks.
  for (const b of bad) b.series = series.filter((s) => s.folder === b.folder || s.folder.startsWith(`${b.folder}/`)).length;
  bad.sort((a, b) => b.series - a.series || a.folder.localeCompare(b.folder));
  return { root: rootOk !== false, rows: bad };
}

export async function folderPermissions(ctx: IgnoreCtx = noIgnores()): Promise<HealthCheck> {
  const me = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid?.() ?? '?'}` : null;
  let found: Awaited<ReturnType<typeof unwritableFolders>>;
  let readFailed = false;
  try { found = await unwritableFolders(); } catch { readFailed = true; found = { root: true, rows: [] }; }
  const all: HealthItem[] = found.rows.map((r) => ({
    title: r.folder,
    key: `folder:${r.folder}`,
    members: [r.folder],
    ...detailOf([say('perm.detail', { owner: r.owner, mode: r.mode, me: me ?? '?', n: r.series, command: me ? `chown -R ${me} "<host path>/${r.folder}" && chmod -R g+rwX "<host path>/${r.folder}"` : '' })]),
  }) as HealthItem & { members: string[] });
  const ignored = applyIgnores('permissions', all, ctx, !readFailed);
  const live = all.filter((i) => !i.info);
  const { items, hidden } = truncate(all);
  const status = !found.root ? 'problem' as const : verdict(all);
  return withAll({
    id: 'permissions',
    title: 'Folder permissions',
    status,
    ...summaryOf([
      !found.root ? say('perm.root') : live.length ? say('perm.live', { n: live.length }) : say('perm.none'),
      ignoredPart(ignored),
    ]),
    ...noteOf([say('perm.note', { me: me ?? '?' }), hiddenPart(hidden)]),
    items,
  }, all);
}
