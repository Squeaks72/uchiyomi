// Health: "Folder permissions" -- series folders the server cannot write to, found before a bulk move trips on them.
// Skipped unless TEST_DATABASE_URL is set, and when run as root (root can write anywhere, so nothing is unwritable).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const DSN = process.env.TEST_DATABASE_URL;
const DL = join(tmpdir(), `uchiyomi-perm-${process.pid}`);
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || '/tmp/uchiyomi-test-config';
  process.env.DL_ROOT = DL;
  process.env.LIBRARY_ROOT = `${DL}-lib`;
}
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const skip = !DSN ? 'set TEST_DATABASE_URL to run' : asRoot ? 'root can write anywhere' : false;
let q: <T = any>(sql: string, p?: any[]) => Promise<T[]>;

before(async () => {
  if (!DSN) return;
  const { migrate } = await import('../src/lib/migrate');
  ({ q } = (await import('../src/lib/db')) as any);
  await migrate();
  await mkdir(join(DL, 'good/Fine'), { recursive: true });
  await mkdir(join(DL, 'locked/Stuck'), { recursive: true });
  await chmod(join(DL, 'locked'), 0o555);
  for (const [id, f] of [['s_pm1', 'good/Fine'], ['s_pm2', 'locked/Stuck']]) {
    await q(`INSERT INTO lib_series (id, source, title, folder, books_count) VALUES ($1,'t',$2,$3,0) ON CONFLICT (id) DO NOTHING`, [id, f.split('/')[1], f]);
  }
});
after(async () => {
  if (!DSN) return;
  await q(`DELETE FROM lib_series WHERE id IN ('s_pm1','s_pm2')`).catch(() => {});
  await chmod(join(DL, 'locked'), 0o755).catch(() => {});
  await rm(DL, { recursive: true, force: true }).catch(() => {});
});

test('a folder the server cannot write to is found, with who owns it and how many series it blocks', { skip }, async () => {
  const { unwritableFolders } = await import('../src/lib/healthPermissions');
  const r = await unwritableFolders(DL);
  assert.ok(r.root);
  assert.deepEqual(r.rows.map((x) => [x.folder, x.series]), [['locked', 1]]);
  assert.match(r.rows[0].mode, /^0555$/);
});

test('the card says so, and is green when every folder is writable', { skip }, async () => {
  const { folderPermissions } = await import('../src/lib/healthPermissions');
  const c = await folderPermissions();
  assert.equal(c.id, 'permissions');
  assert.equal(c.status, 'warn');
  assert.equal(c.items.length, 1);
  await chmod(join(DL, 'locked'), 0o755);
  assert.equal((await folderPermissions()).status, 'ok');
});
