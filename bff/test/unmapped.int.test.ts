// Unmapped files against a real database and real folders: what is listed, where a map lands, and that deleting is a
// move to the bin (restorable, expiring), never a chapter of the library. Skipped unless TEST_DATABASE_URL is set.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, stat, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const DSN = process.env.TEST_DATABASE_URL;
const DL = join(tmpdir(), `uchiyomi-um-${process.pid}`);
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || '/tmp/uchiyomi-test-config';
  process.env.LIBRARY_ROOT = join(tmpdir(), `uchiyomi-um-lib-${process.pid}`);
  process.env.DL_ROOT = DL;
}
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';
const exists = (p: string) => stat(p).then(() => true, () => false);
const old = async (p: string) => { const t = new Date(Date.now() - 3600_000); await utimes(p, t, t); };
async function put(rel: string, body = 'x') {
  await mkdir(join(DL, rel, '..'), { recursive: true });
  await writeFile(join(DL, rel), body);
  await old(join(DL, rel));
}

let q: <T = any>(sql: string, p?: any[]) => Promise<T[]>;
let U: typeof import('../src/lib/unmapped');
const S = 's_um_series';

before(async () => {
  if (!DSN) return;
  const { migrate } = await import('../src/lib/migrate');
  ({ q } = (await import('../src/lib/db')) as any);
  U = await import('../src/lib/unmapped');
  await migrate();
});
beforeEach(async () => {
  if (!DSN) return;
  await q('DELETE FROM unmapped_recycle');
  await q('DELETE FROM lib_books WHERE series_id = $1', [S]);
  await q('DELETE FROM lib_series WHERE id = $1', [S]);
  await rm(DL, { recursive: true, force: true });
  await mkdir(DL, { recursive: true });
  await q(`INSERT INTO lib_series (id, source, title, folder, books_count) VALUES ($1,'MangaDex','Berserk','MangaDex/Berserk',1)`, [S]);
  await q(`INSERT INTO lib_books (id, series_id, source, file, number, title, root) VALUES ('b_um_1',$1,'MangaDex','MangaDex/Berserk/Chapter 1.cbz',1,'Chapter 1',$2)`, [S, DL]);
  await put('MangaDex/Berserk/Chapter 1.cbz');
});
after(async () => {
  if (!DSN) return;
  await q('DELETE FROM unmapped_recycle').catch(() => {});
  await q('DELETE FROM lib_books WHERE series_id = $1', [S]).catch(() => {});
  await q('DELETE FROM lib_series WHERE id = $1', [S]).catch(() => {});
  await rm(DL, { recursive: true, force: true }).catch(() => {});
});

test('lists what the library does not hold, grouped, with a suggested series; never a library chapter', { skip }, async () => {
  await put('Dropbox/berserk/Berserk - 042.cbz');
  await put('Dropbox/berserk/notes.txt');
  await put('.hidden/x.cbz');
  await mkdir(join(DL, '.recycle'), { recursive: true });
  const l = await U.listUnmapped();
  assert.deepEqual(l.groups.map((g) => g.folder), ['Dropbox/berserk']);
  const g = l.groups[0];
  assert.deepEqual(g.files.map((f) => [f.name, f.kind, f.guess]), [['Berserk - 042.cbz', 'archive', 42], ['notes.txt', 'other', null]]);
  assert.equal(g.suggest?.id, S);
});

test('a file written a moment ago is left for the scan, not listed', { skip }, async () => {
  await mkdir(join(DL, 'New'), { recursive: true });
  await writeFile(join(DL, 'New/Chapter 9.cbz'), 'x');
  assert.deepEqual((await U.listUnmapped()).groups, []);
});

test('mapping moves archives in as Chapter N, and refuses a taken number, a non-archive and a library chapter', { skip }, async () => {
  await put('Dropbox/a.cbz'); await put('Dropbox/b.zip'); await put('Dropbox/c.cbz'); await put('Dropbox/n.txt');
  const r = await U.mapFiles('MangaDex/Berserk', [
    { path: 'Dropbox/a.cbz', number: 2 }, { path: 'Dropbox/b.zip', number: 3 },
    { path: 'Dropbox/c.cbz', number: 1 }, { path: 'Dropbox/n.txt', number: 4 },
    { path: 'MangaDex/Berserk/Chapter 1.cbz', number: 9 },
  ]);
  assert.deepEqual(r.map((x) => x.ok), [true, true, false, false, false]);
  assert.ok(await exists(join(DL, 'MangaDex/Berserk/Chapter 2.cbz')));
  assert.ok(await exists(join(DL, 'MangaDex/Berserk/Chapter 3.zip')));
  assert.ok(!(await exists(join(DL, 'Dropbox/a.cbz'))));
  assert.ok(await exists(join(DL, 'Dropbox/c.cbz')), 'a refused file moved anyway');
  assert.ok(await exists(join(DL, 'MangaDex/Berserk/Chapter 1.cbz')));
});

test('delete goes to the bin and restores; a library chapter is refused; purge removes only expired or named files', { skip }, async () => {
  await put('Junk/a.jpg');
  const r = await U.recycleFiles(['Junk/a.jpg', 'MangaDex/Berserk/Chapter 1.cbz', '../outside'], null);
  assert.deepEqual(r.map((x) => x.ok), [true, false, false]);
  assert.ok(!(await exists(join(DL, 'Junk/a.jpg'))));
  assert.ok(await exists(join(DL, 'MangaDex/Berserk/Chapter 1.cbz')), 'a library chapter was recycled');
  assert.equal((await U.listRecycled()).rows.length, 1);
  assert.equal(await U.purgeRecycled(), 0, 'a fresh entry was purged');

  const [row] = (await U.listRecycled()).rows;
  assert.deepEqual((await U.restoreRecycled([row.id])).map((x) => x.ok), [true]);
  assert.ok(await exists(join(DL, 'Junk/a.jpg')));

  await U.recycleFiles(['Junk/a.jpg'], null);
  await q(`UPDATE unmapped_recycle SET deleted_at = now() - interval '30 days'`);
  assert.equal(await U.purgeRecycled(), 1);
  assert.equal((await U.listRecycled()).rows.length, 0);
});
