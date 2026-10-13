// With Show 18+ off a source's extension flag no longer condemns its titles (lib/searchAll.ts ratingOf `trustFlag`).
// Suwayomi flags whole extensions, so most mainstream sites carry it; each title is judged by its own signals instead.
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';

// Imported after the environment is set: env.ts validates DATABASE_URL on load, and nothing here connects.
let ratingOf: typeof import('../src/lib/searchAll').ratingOf;
let cardRating: typeof import('../src/lib/searchAll').cardRating;
before(async () => { ({ ratingOf, cardRating } = await import('../src/lib/searchAll')); });

const lists = { genres: ['hentai', 'smut'], sources: ['sw:99'] };
const flagged = { id: 'sw:1', isNsfw: true };

test('the flag is a verdict by default and a non-verdict when not trusted', () => {
  assert.equal(ratingOf({}, flagged, lists), 'flagged');
  assert.equal(ratingOf({}, flagged, lists, false), undefined, 'a title nothing speaks against is unknown, so shown');
});

test('an untrusted flag still lets the title\'s own signals decide', () => {
  assert.equal(ratingOf({ genres: ['Hentai'] }, flagged, lists, false), 'adult', 'an adult genre on a flagged site is still 18+');
  assert.equal(ratingOf({ contentRating: 'pornographic' }, flagged, lists, false), 'adult');
  assert.equal(ratingOf({ contentRating: 'safe' }, flagged, lists, false), 'safe');
  assert.equal(ratingOf({ genres: ['Action'] }, flagged, lists, false), 'safe', 'named genres, none adult');
});

test('a source the admin named is 18+ whatever the flag is trusted for', () => {
  assert.equal(ratingOf({}, { id: 'SW:99' }, lists, false), 'adult');
  assert.equal(ratingOf({}, { id: 'sw:99', isNsfw: true }, lists, false), 'adult');
});

test('a card whose only provider is flagged is shown when the flag is not trusted', () => {
  assert.equal(cardRating([ratingOf({}, flagged, lists)]), 'adult');
  assert.equal(cardRating([ratingOf({}, flagged, lists, false)]), undefined);
});
