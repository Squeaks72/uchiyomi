// A failed READ of a chapter file is not a broken file: it must not be stamped 0 (which made ~13,800 readable chapters a permanent
// finding on Health's "Chapter files" card). A gone or truly broken file is still 0.
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a missing file is 0 and a file with no images is 0, but an unknown read failure is null (not stamped)', async () => {
  const { countPagesOrNull } = await import('../src/lib/pageCount');
  const dir = mkdtempSync(join(tmpdir(), 'pc-'));
  assert.equal(await countPagesOrNull(join(dir, 'gone.cbz')), 0, 'a file that is gone cannot be read, for real');
  const junk = join(dir, 'junk.cbz');
  writeFileSync(junk, 'this is not a zip');
  assert.equal(await countPagesOrNull(junk), 0, 'a file that is not an archive at all is truly unreadable');
});

test('health: Recheck on the files, disk and trackers cards is accepted (it answered "Invalid option")', async () => {
  const { RECHECKABLE_CHECKS } = await import('../src/lib/health');
  for (const id of ['files', 'disk', 'trackers']) assert.ok((RECHECKABLE_CHECKS as readonly string[]).includes(id), `${id} cannot be rechecked`);
});

test('the count step leaves a failed read unstamped', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(__dirname, '..', 'src/lib/repair.ts'), 'utf8');
  assert.match(src, /if \(pages === null\) \{ cur\.done!\+\+; return; \}/, 'a failed read is stamped 0 again');
});

test('the Chapter files card cannot keep a wrong stamp: it re-counts a bounded few before it is built, and Recheck re-counts more', async () => {
  const { readFileSync } = await import('node:fs');
  const files = readFileSync(join(__dirname, '..', 'src/lib/healthFiles.ts'), 'utf8');
  assert.match(files, /recountUnreadable\(\{ max: 200, conc: 2, staleMs: 24 \* 60 \* 60 \* 1000 \}\)/, 'the card is built from stamps nobody re-reads');
  assert.match(files, /pages_checked_at < now\(\) - \(\$2::bigint \* interval '1 millisecond'\)/, 'a truly bad file is re-opened at every run');
  const health = readFileSync(join(__dirname, '..', 'src/lib/health.ts'), 'utf8');
  assert.match(health, /case 'files': await recountUnreadable\(\{ max: 1000 \}\)/, 'Recheck on the files card does not look at the files');
});

test('nothing else writes a page count of 0 with a stamp: the only writers read the file with countPagesOrNull', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = join(__dirname, '..', 'src/lib');
  const writers = readdirSync(dir).filter((f) => f.endsWith('.ts') && /pages_checked_at\s*=\s*now\(\)/.test(readFileSync(join(dir, f), 'utf8')));
  assert.deepEqual(writers.sort(), ['healthFiles.ts', 'repair.ts'], 'a new writer of the stamp: it must count with countPagesOrNull and skip a null');
  for (const f of writers) assert.match(readFileSync(join(dir, f), 'utf8'), /countPagesOrNull/, `${f} stamps without countPagesOrNull`);
});
