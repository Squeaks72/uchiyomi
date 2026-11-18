import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripOf, isStamp } from '../src/lib/edgeMarks';

const W = 512;
/** Pages whose first `k` rows (from the edge) are `strip(x, row)` on every page, and noise-like art past them. */
function pages(n: number, k: number, strip: (x: number, y: number) => number): Uint8Array[][] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256);
  return Array.from({ length: n }, () => Array.from({ length: 120 }, (_, y) => {
    const r = new Uint8Array(W);
    for (let x = 0; x < W; x++) r[x] = y < k ? strip(x, y) : rnd();
    return r;
  }));
}

test('a strip of writing on every page, with the art changing under it, is a stamp', () => {
  // Glyph-like: dark and light flipping every few pixels.
  const s = stripOf(pages(8, 20, (x, y) => (y > 4 && y < 16 && (x >> 2) % 2 ? 20 : 240)));
  assert.ok(s, 'no strip found');
  assert.equal(s!.k, 20);
  assert.ok(isStamp(s!), `not taken for a stamp: ${JSON.stringify(s)}`);
});

test('a plain white margin, as constant as a banner, is not a stamp', () => {
  const s = stripOf(pages(8, 20, () => 255));
  assert.ok(!s || !isStamp(s));
});

test('fewer than four pages of a width: nothing is decided', () => {
  assert.equal(stripOf(pages(3, 20, (x) => (x % 4 ? 0 : 255))), null);
});
