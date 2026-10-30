// Chapters that would not download: a source's row carries its newest chapters, and one only waiting for its first try at the
// series' current source says so instead of reading as a failure.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const DSN = process.env.TEST_DATABASE_URL;
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || '/tmp/uchiyomi-test-config';
}
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';
let q: <T = any>(sql: string, p?: any[]) => Promise<T[]>;

before(async () => {
  if (!DSN) return;
  const { migrate } = await import('../src/lib/migrate');
  ({ q } = (await import('../src/lib/db')) as any);
  await migrate();
  await q(`DELETE FROM chapter_failures WHERE series_id = 's_fc1'`);
  await q(`INSERT INTO lib_series (id, source, title, folder, books_count) VALUES ('s_fc1','t','Blue Lock','t/Blue Lock',0) ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO chapter_failures (series_id, number, source_id, status, reason, attempts) VALUES
    ('s_fc1', 335, 'sw:fc', 'moved', 'incomplete chapter: 18 of 20 pages', 0),
    ('s_fc1', 340, 'sw:fc', 'incomplete', 'incomplete chapter: 3 of 20 pages', 2)`);
});
after(async () => {
  if (!DSN) return;
  await q(`DELETE FROM chapter_failures WHERE series_id = 's_fc1'`).catch(() => {});
  await q(`DELETE FROM lib_series WHERE id = 's_fc1'`).catch(() => {});
});

test('a failing source row lists its chapters, and tells waiting from tried', { skip }, async () => {
  const { runHealthChecks } = await import('../src/lib/health');
  const check = (await runHealthChecks()).checks.find((c) => c.id === 'chapter-failures')!;
  const row = check.items.find((i) => i.sourceId === 'sw:fc')!;
  assert.ok(row, 'the source row is missing');
  const byNumber = new Map((row.failed ?? []).map((c) => [c.number, c]));
  assert.equal(byNumber.get(335)?.waiting, true);
  assert.equal(byNumber.get(340)?.waiting, false);
  assert.equal(byNumber.get(340)?.attempts, 2);
  assert.equal(byNumber.get(335)?.title, 'Blue Lock');
});
