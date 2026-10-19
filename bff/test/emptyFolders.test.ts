// The nightly empty-folder sweep: it may only ever rmdir, and it must leave alone anything a series or library still
// points at, hidden/system folders, symlinks, roots and anything touched recently. Pure: temp directories, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, utimes, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The module's imports read the environment; no query is made here, so a placeholder address is enough.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@localhost:1/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
const sweepEmptyFolders: typeof import('../src/lib/emptyFolders').sweepEmptyFolders = (...a) =>
  import('../src/lib/emptyFolders').then((m) => m.sweepEmptyFolders(...a));

const exists = (p: string) => lstat(p).then(() => true, () => false);
const old = async (p: string) => { const t = new Date(Date.now() - 3 * 3600_000); await utimes(p, t, t); };

async function tree() {
  const root = await mkdtemp(join(tmpdir(), 'empty-folders-'));
  return { root, done: () => rm(root, { recursive: true, force: true }) };
}

test('removes an empty folder, one level a night: emptying a child makes its parent recent', async () => {
  const { root, done } = await tree();
  try {
    await mkdir(join(root, 'a/b/c'), { recursive: true });
    for (const d of ['a/b/c', 'a/b', 'a']) await old(join(root, d));
    const first = await sweepEmptyFolders([root], new Set());
    assert.deepEqual(first.removed.map((p) => p.slice(root.length)), ['/a/b/c']);
    await old(join(root, 'a/b'));
    const second = await sweepEmptyFolders([root], new Set());
    assert.deepEqual(second.removed.map((p) => p.slice(root.length)), ['/a/b']);
    assert.ok(await exists(root), 'the root was removed');
  } finally { await done(); }
});

test('a folder holding a file is never touched, nor are its parents', async () => {
  const { root, done } = await tree();
  try {
    await mkdir(join(root, 'series/ch'), { recursive: true });
    await writeFile(join(root, 'series/ch/1.cbz'), 'x');
    for (const d of ['series/ch', 'series']) await old(join(root, d));
    const r = await sweepEmptyFolders([root], new Set());
    assert.deepEqual(r.removed, []);
    assert.ok(await exists(join(root, 'series/ch/1.cbz')));
  } finally { await done(); }
});

test('a folder a series or library still points at is kept even when empty', async () => {
  const { root, done } = await tree();
  try {
    await mkdir(join(root, 'Manga/New Series'), { recursive: true });
    await mkdir(join(root, 'Manga/Gone'), { recursive: true });
    for (const d of ['Manga/New Series', 'Manga/Gone', 'Manga']) await old(join(root, d));
    const r = await sweepEmptyFolders([root], new Set(['Manga/New Series']));
    assert.deepEqual(r.removed.map((p) => p.slice(root.length)), ['/Manga/Gone']);
    assert.ok(await exists(join(root, 'Manga/New Series')));
    assert.ok(await exists(join(root, 'Manga')), 'a parent of a kept folder was removed');
  } finally { await done(); }
});

test('hidden and system folders, symlinks and recently touched folders are left alone', async () => {
  const { root, done } = await tree();
  try {
    for (const d of ['.hidden', '#recycle', '@eaDir', 'fresh', 'real']) await mkdir(join(root, d));
    await symlink(join(root, 'real'), join(root, 'link'));
    for (const d of ['.hidden', '#recycle', '@eaDir', 'real']) await old(join(root, d));
    const r = await sweepEmptyFolders([root], new Set());
    assert.deepEqual(r.removed.map((p) => p.slice(root.length)), ['/real']);
    for (const d of ['.hidden', '#recycle', '@eaDir', 'fresh', 'link']) assert.ok(await exists(join(root, d)), `${d} was removed`);
  } finally { await done(); }
});

test('a root that is missing is skipped, not an error', async () => {
  const r = await sweepEmptyFolders(['/nonexistent/uchiyomi-root'], new Set());
  assert.deepEqual(r.removed, []);
});
