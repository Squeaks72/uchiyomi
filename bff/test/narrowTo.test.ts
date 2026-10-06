// The `sources` query of search-all: a comma list of ids to ask, or null for "every source".
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';

let S: typeof import('../src/lib/searchAll');
before(async () => {
  S = await import('../src/lib/searchAll');
});

test('narrowTo: a comma list becomes a set, trimmed', () => {
  assert.deepEqual([...S.narrowTo('sw:1, sw:2 ,,sw:3')!], ['sw:1', 'sw:2', 'sw:3']);
});

test('narrowTo: absent, empty or not a string means every source', () => {
  assert.equal(S.narrowTo(undefined), null);
  assert.equal(S.narrowTo(''), null);
  assert.equal(S.narrowTo(' , '), null);
  assert.equal(S.narrowTo(['sw:1']), null);
});

test('narrowTo: at most 200 ids', () => {
  const raw = Array.from({ length: 500 }, (_, i) => `sw:${i}`).join(',');
  assert.equal(S.narrowTo(raw)!.size, 200);
});
