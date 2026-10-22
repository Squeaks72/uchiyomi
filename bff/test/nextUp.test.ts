// "Only tell me about a new chapter when it is the one I'd read next": the rule (lib/nextUp.ts nextUpIn), the series page's own.
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';

let N: typeof import('../src/lib/nextUp');
before(async () => { N = await import('../src/lib/nextUp'); });
const b = (number: number, done = false, page = 0) => ({ number, done, page });

test('caught up: the new chapter is next', () => {
  assert.equal(N.nextUpIn([b(1, true), b(2, true), b(3)], [3]), true);
});

test('an older unread chapter after the highest finished one is next, not the new one', () => {
  assert.equal(N.nextUpIn([b(1, true), b(2), b(3)], [3]), false, 'chapter 2 is next');
  assert.equal(N.nextUpIn([b(1, true), b(2), b(3), b(4)], [3, 4]), false);
});

test('a chapter skipped BEFORE the highest finished one does not count: the series page says "Next" after the highest', () => {
  assert.equal(N.nextUpIn([b(1, true), b(2), b(3, true), b(4)], [4]), true);
});

test('a part-read chapter is the one to continue, so nothing new is next', () => {
  assert.equal(N.nextUpIn([b(1, true), b(2, false, 5), b(3)], [3]), false);
});

test('nothing read: only the first chapter is next', () => {
  assert.equal(N.nextUpIn([b(1), b(2), b(3)], [3]), false);
  assert.equal(N.nextUpIn([b(1)], [1]), true);
});

test('chapters that landed together: the lowest of them being next is enough', () => {
  assert.equal(N.nextUpIn([b(1, true), b(2), b(3)], [2, 3]), true);
});

test('wiring: push and the digest ask it, and an upgrade announcement (no numbers) never does', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const r = (f: string) => readFileSync(join(__dirname, '..', 'src/lib', f), 'utf8');
  assert.match(r('push.ts'), /opts\.numbers\?\.length && \(await notifyOnlyNextOn\(f\.user_id\)\) && !\(await isNextUp\(f\.user_id, seriesId, opts\.numbers\)\)/, 'push ignores the setting');
  assert.match(r('notify/index.ts'), /t\.user_id && \(await notifyOnlyNextOn\(t\.user_id\)\)/, 'the digest ignores the setting');
  assert.match(r('updater.ts'), /notifyNewChapter\(seriesId, s\.title, notifiable, undefined, \{ numbers: notifiableNumbers \}\)/, 'the sweep does not say which chapters landed');
});
