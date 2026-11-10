import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@localhost:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
const sortSql = async () => (await import('../src/lib/ownedCatalog'))._sortSql;

test('rating sorts by the viewer\'s stars, unrated last in both directions', async () => {
  const s = await sortSql();
  assert.equal(s('rating,desc', true), 'rt.stars DESC NULLS LAST, title ASC');
  assert.equal(s('rating,asc', true), 'rt.stars ASC NULLS LAST, title ASC');
});

test('recently read sorts by the viewer\'s last read, never-read last', async () => {
  const s = await sortSql();
  assert.equal(s('lastRead,desc', true), 'm.last_at DESC NULLS LAST, title ASC');
});

test('chapters needs no user', async () => {
  const s = await sortSql();
  assert.equal(s('chapters,desc', false), 'books_count DESC, title ASC');
});

test('per-user sorts degrade to title order without a user rather than naming a join that is not there', async () => {
  const s = await sortSql();
  assert.equal(s('rating,desc', false), 'title DESC');
  assert.equal(s('lastRead,desc', false), 'title DESC');
});

test('the older sorts still resolve to what they did', async () => {
  const s = await sortSql();
  assert.equal(s('lastModified,desc'), 'latest_mtime DESC');
  assert.equal(s('createdDate,desc'), 'created_at DESC');
  assert.equal(s('metadata.titleSort,asc'), 'title ASC');
  assert.equal(s('metadata.titleSort,desc'), 'title DESC');
  assert.equal(s('unread,desc', true), '(books_count - COALESCE(m.done, 0)) DESC');
  assert.equal(s('author,asc'), 'author ASC NULLS LAST');
});
