// Revised chapters (lib/repair.ts revisionOf): what the listing says changed about a chapter's own source copy.
// The database half -- the step replacing the file -- needs a source and a disk and is walked by hand.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
process.env.CONFIG_DIR ||= '/tmp/uchiyomi-test-config';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const copy = (o: Record<string, unknown>) => ({ sourceId: 'c1', source: 'sw:1', groups: ['Alpha'], scanlator: 'Alpha', lang: 'en', pages: 20, publishedAt: day(10), ...o }) as any;
const book = (o: Record<string, unknown> = {}) => ({ source_id: 'sw:1', source_chapter_id: 'c1', scanlator: 'Alpha', rev_published_at: new Date(day(10)), rev_pages: 20, ...o }) as any;

test('nothing recorded yet: stamp the baseline, replace nothing', async () => {
  const { revisionOf } = await import('../src/lib/repair');
  const r = revisionOf(book({ rev_published_at: null, rev_pages: null }), [copy({ publishedAt: day(1), pages: 25 })], NOW);
  assert.equal(r?.kind, 'stamp');
});

test('an unchanged copy is left alone', async () => {
  const { revisionOf } = await import('../src/lib/repair');
  assert.equal(revisionOf(book(), [copy({})], NOW), null);
});

test('a moved page count, or a date that moved and settled, is a revision', async () => {
  const { revisionOf } = await import('../src/lib/repair');
  assert.equal(revisionOf(book(), [copy({ pages: 22 })], NOW)?.kind, 'post');
  assert.equal(revisionOf(book(), [copy({ publishedAt: day(3) })], NOW)?.kind, 'post');
});

test('a date within a day of now is not believed (fetch-time dates)', async () => {
  const { revisionOf } = await import('../src/lib/repair');
  assert.equal(revisionOf(book(), [copy({ publishedAt: new Date(NOW - 3600_000).toISOString() })], NOW), null);
});

test('a re-post: the post is gone and one copy by the same group is listed', async () => {
  const { revisionOf } = await import('../src/lib/repair');
  const r = revisionOf(book(), [copy({ sourceId: 'c2' })], NOW);
  assert.equal(r?.kind, 'reposted');
  assert.equal(r?.copy.sourceId, 'c2');
});

test('a re-post is not guessed: another group, two candidates, another source, or an external link', async () => {
  const { revisionOf } = await import('../src/lib/repair');
  assert.equal(revisionOf(book(), [copy({ sourceId: 'c2', scanlator: 'Beta', groups: ['Beta'] })], NOW), null);
  assert.equal(revisionOf(book(), [copy({ sourceId: 'c2' }), copy({ sourceId: 'c3' })], NOW), null);
  assert.equal(revisionOf(book(), [copy({ sourceId: 'c2', source: 'sw:2' })], NOW), null);
  assert.equal(revisionOf(book(), [copy({ sourceId: 'c2', pages: 0 })], NOW), null);
});
