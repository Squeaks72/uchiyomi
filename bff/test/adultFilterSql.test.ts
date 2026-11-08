// The 18+ filter reads its genre list from the database, never from a string (and no longer for library series).
//
// `browsable()` cannot bind parameters (25 call sites interpolate its result into queries with hand-written
// parameter arrays), and the first version of the configurable filter therefore pasted the admin's genre names
// into the query as literals, behind a strict character whitelist -- the one place in the codebase admin-entered
// data met a query string. The list now stays in the database: `browsable()` names the column and reads it with
// jsonb_array_elements_text, so no value can escape anything, the whitelist is gone (it was also rejecting real
// genres: "Boys’ Love", Thai, Devanagari), and the rule holds for a context built without the lists at all --
// which is how the notification digest builds its own.
//
// adultFilter.int.test.ts runs the clause against real Postgres. This pins the string without a database.
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import type { ViewCtx } from '../src/lib/visibility';

// Imported after the environment is set: a static import is hoisted above the assignments, and env.ts
// validates DATABASE_URL on load. Nothing here connects -- `browsable()` only builds a string.
let V: typeof import('../src/lib/visibility');
before(async () => { V = await import('../src/lib/visibility'); });

const ctx = (adultGenres: string[], extra: Partial<ViewCtx> = {}): ViewCtx =>
  ({ ...V.SYSTEM_CTX, hideAdultLibraries: true, adultGenres, adultSources: [], ...extra });

test('no configured value ever appears in the SQL, whatever the context holds', () => {
  const hostile = ["x') OR true --", "'; DROP TABLE lib_series; --", 'e\\\' OR 1=1 --', '$1', 'ecchi'];
  const p = new V.Params();
  const sql = V.browsable('s', ctx(hostile), p);
  for (const h of hostile) assert.ok(!sql.includes(h), `the value ${JSON.stringify(h)} reached the query`);
  assert.deepEqual(p.values, [], 'browsable() bound a parameter, which its 25 call sites cannot carry');
});

test('a series in the library is judged by its library alone, genres and own rating included', () => {
  // Reintroduce the genre or series-rating clause in browsable(): the Dandadan bug, a series filed in an
  // ordinary library vanishing while "Show 18+" was off.
  const sql = V.browsable('s', ctx(['ecchi']), new V.Params());
  assert.doesNotMatch(sql, /adult_genres/, 'a genre list judges a series that is already filed');
  assert.doesNotMatch(sql, /o_ar\./, "a series' own rating judges a series that is already filed");
  assert.match(sql, /l_ad\.age_rating/, 'the library rating is the rule');
});

test('the reveal switches the 18+ clause off entirely', () => {
  assert.doesNotMatch(V.browsable('s', ctx(['ecchi'], { hideAdultLibraries: false }), new V.Params()), /l_ad/);
});

test('sanitiseAdultList keeps genres as typed, tidies them, and refuses only what is not a label', () => {
  assert.deepEqual(
    V.sanitiseAdultList(['Ecchi', ' Sci-Fi ', 'Boys’ Love', "Girls' Love", 'ecchi', 'エッチ', 'อีโรติก', 'रोमांस', '18+ (R)']),
    ['Ecchi', 'Sci-Fi', 'Boys’ Love', "Girls' Love", 'エッチ', 'อีโรติก', 'रोमांस', '18+ (R)'],
    'kept as typed, de-duplicated case-blind (the second "ecchi" goes)',
  );
  for (const bad of ['nul\u0000', 'line\nbreak', 'tab\there', 'x'.repeat(61), '', '   '])
    assert.deepEqual(V.sanitiseAdultList([bad]), [], `kept ${JSON.stringify(bad)}`);
  for (const notList of [null, undefined, 'ecchi', { 0: 'ecchi' }, 42]) assert.deepEqual(V.sanitiseAdultList(notList), []);
  assert.deepEqual(V.sanitiseAdultList([{ toString: () => 'x' }, ['nested']]), []);
});

test('sanitiseSourceIds keeps real source ids, which the genre shape used to drop', () => {
  // `_` and anything past 60 characters were lost between saving and the next read: the chip lit, then went dark.
  assert.deepEqual(
    V.sanitiseSourceIds(['aqua', 'SW:8683375824843625513', 'my_site.v2', 'a'.repeat(120), 'aqua']),
    ['aqua', 'sw:8683375824843625513', 'my_site.v2', 'a'.repeat(120)],
  );
  for (const bad of ['has space', "quo'te", 'a'.repeat(121), '', 'semi;colon'])
    assert.deepEqual(V.sanitiseSourceIds([bad]), [], `kept ${JSON.stringify(bad)}`);
});

test('sourceBrowsableFor: named sources hide only while the switch is on, case-insensitively', () => {
  const on = ctx([], { adultSources: ['sw:99'] });
  assert.equal(V.sourceBrowsableFor({ id: 'SW:99' }, on), false);
  assert.equal(V.sourceBrowsableFor({ id: 'sw:100' }, on), true);
  assert.equal(V.sourceBrowsableFor({ id: 'sw:100', isNsfw: true }, on), false, 'the extension flag stopped counting');
  assert.equal(V.sourceBrowsableFor({ id: 'sw:99' }, { ...on, hideAdultLibraries: false }), true);
  // The permission still wins over the reveal: an account capped below 18 never reaches an NSFW source.
  assert.equal(V.sourceBrowsableFor({ id: 'x', isNsfw: true }, { ...on, hideAdultLibraries: false, maxAgeRating: 16 }), false);
});

test('there is no per-series override: the library rating is the whole rule, and binds nothing', () => {
  // Reintroduce adult_exempt in browsable(): "Always show" comes back as a second way to file a series.
  const p = new V.Params();
  const sql = V.browsable('s', ctx([]), p);
  assert.doesNotMatch(sql, /adult_exempt/);
  assert.match(sql, /l_ad\.age_rating >= 18/);
  assert.deepEqual(p.values, []);
  assert.match(V.browsable('s', ctx([], { maxAgeRating: 12 }), new V.Params()), /age_rating IS NULL OR|<= \$/, 'the age cap is still applied');
});

test('adult_exempt never reaches visible(): the age cap stays the permission', () => {
  // PR #130 let the flag lift a capped account's age limit in visible(); v0.50.0 left that part out. Reintroduce by
  // OR-ing adult_exempt into the cap clause: the first assertion finds it. adultFilter.int.test.ts runs the same
  // rule against Postgres ("a capped account still cannot open an exempt 18+ series").
  const v = V.visible('s', ctx([], { maxAgeRating: 12 }), new V.Params());
  assert.doesNotMatch(v, /adult_exempt/, 'the permission reads the shelf switch');
  assert.match(v, /IS NULL OR .*<= \$1/s, 'the cap itself is still bound');
});
