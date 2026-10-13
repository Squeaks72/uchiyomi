import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCE_AGES, ageChoice, ageRequest, effectiveAge } from '../lib/sourceAge';

test('a source with no rating of its own is held to what its extension says', () => {
  assert.equal(effectiveAge({ ageRating: null, defaultAgeRating: 18 }), 18);
  assert.equal(effectiveAge({ defaultAgeRating: null }), null);
  assert.equal(ageChoice({ ageRating: null, defaultAgeRating: 18 }), 'default');
});

test('the admin rating wins, and 0 (all ages) cancels an adult flag', () => {
  assert.equal(effectiveAge({ ageRating: 13, defaultAgeRating: 18 }), 13);
  assert.equal(effectiveAge({ ageRating: 0, defaultAgeRating: 18 }), null);
  assert.equal(ageChoice({ ageRating: 0 }), 0, 'all ages is a choice of its own, not the default');
});

test('a chip becomes the body of the PUT', () => {
  assert.deepEqual(ageRequest('default'), { ageRating: null });
  assert.deepEqual(ageRequest(0), { ageRating: 0 });
  assert.deepEqual(ageRequest(17), { ageRating: 17 });
  assert.ok(SOURCE_AGES.every((n) => Number.isInteger(n) && n >= 0 && n <= 18));
});

test('the sheet offers the rating on every source and sends it to the age-rating route', () => {
  const src = readFileSync(join(__dirname, '..', 'components', 'SourceSheet.tsx'), 'utf8');
  assert.match(src, /data-source-age/);
  assert.match(src, /\/age-rating`, \{ method: 'PUT', json: ageRequest\(c\) \}/);
});
