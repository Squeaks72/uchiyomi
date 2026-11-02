// Mixed sources: flagged 18+ by their extension, but most of what they carry is not. With Show 18+ off they are still
// asked, each title is judged alone, and the age cap is untouched.
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import type { AdultLists } from '../src/lib/searchAll';
import type { ViewCtx } from '../src/lib/visibility';

// Imported after the environment is set (env.ts validates it on load). Nothing here connects.
let S: typeof import('../src/lib/searchAll');
let V: typeof import('../src/lib/visibility');
before(async () => { S = await import('../src/lib/searchAll'); V = await import('../src/lib/visibility'); });
const ratingOf = (...a: Parameters<typeof import('../src/lib/searchAll').ratingOf>) => S.ratingOf(...a);
const mixedRating = (...a: Parameters<typeof import('../src/lib/searchAll').mixedRating>) => S.mixedRating(...a);
const lists = (o: Partial<AdultLists> = {}): AdultLists => ({ genres: [], sources: [], mixed: ['sw:1'], mixedShowUnknown: false, ...o });
const src = { id: 'sw:1', isNsfw: true };

test('a title of a Mixed source is judged on its own genres and rating', () => {
  assert.equal(mixedRating({ genres: ['Action', 'Hentai'] }, lists()), 'adult', 'a default adult genre');
  assert.equal(mixedRating({ genres: ['Action'], contentRating: undefined }, lists({ genres: ['Ecchi'] })), 'safe', 'genres named, none adult');
  assert.equal(mixedRating({ genres: ['ecchi'] }, lists({ genres: ['Ecchi'] })), 'adult', 'the admin\'s own list counts, case-blind');
  assert.equal(mixedRating({ genres: [], contentRating: 'safe' }, lists()), 'safe', 'MangaDex says safe');
  assert.equal(mixedRating({ genres: ['Action'], contentRating: 'erotica' }, lists()), 'adult', 'MangaDex says erotica, whatever the genres');
  assert.equal(mixedRating({ genres: [] }, lists()), undefined, 'nothing to judge it by');
  assert.ok(S.DEFAULT_ADULT_GENRES.includes('hentai'));
});

test('ratingOf: a Mixed title is safe or adult by itself; an unjudgeable one reads 18+ unless the admin shows them', () => {
  assert.equal(ratingOf({ genres: ['Action'] }, src, lists()), 'safe');
  assert.equal(ratingOf({ genres: ['Smut'] }, src, lists()), 'adult');
  assert.equal(ratingOf({ genres: [] }, src, lists()), 'flagged', 'fails closed: hidden under Hide 18+');
  assert.equal(ratingOf({ genres: [] }, src, lists({ mixedShowUnknown: true })), undefined, 'shown when the admin chose to');
  // Not rated Mixed -> the old rule: the extension's flag decides.
  assert.equal(ratingOf({ genres: ['Action'] }, { id: 'sw:2', isNsfw: true }, lists()), 'flagged');
  // Rated Adult only wins over Mixed.
  assert.equal(ratingOf({ genres: ['Action'] }, src, lists({ sources: ['sw:1'] })), 'adult');
});

test('Mixed is surfacing only: with Show 18+ off the source stays, and the age cap still refuses it', () => {
  V.applyAdultSources([]);
  V.applyMixedSources(['sw:1']);
  const hiding = { userId: 'u', libraryIds: null, maxAgeRating: null, hideAdultLibraries: true, adultGenres: [], adultSources: [] } as unknown as ViewCtx;
  assert.equal(V.sourceBrowsableFor(src, hiding), true, 'a Mixed source is still on the shelf');
  assert.equal(V.sourceBrowsableFor({ id: 'sw:2', isNsfw: true }, hiding), false, 'an unrated flagged source is not');
  // The permission is not touched: an account capped below 18 cannot use the whole source.
  assert.equal(V.sourceAllowedFor(src, 12), false, 'the age cap ignores Mixed');
  assert.equal(V.sourceAllowedFor(src, null), true);
  // Adult only excludes it again.
  V.applyAdultSources(['sw:1']);
  assert.equal(V.sourceRatedMixed(src), false, 'Adult only wins over Mixed');
  assert.equal(V.sourceBrowsableFor(src, hiding), false);
  V.applyAdultSources([]);
  V.applyMixedSources([]);
});
