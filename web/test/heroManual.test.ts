// The home banner (components/HeroCarousel.tsx, 2026-11-18): tap a side or swipe to step, and any move by hand stops the turning.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'components/HeroCarousel.tsx'), 'utf8');

test('a move by hand holds the banner', () => {
  assert.match(src, /const go = \(d: number\) => \{ setHeld\(true\);/);
  assert.match(src, /const goTo = \(k: number\) => \{ setHeld\(true\); setI\(k\); \};/);
  assert.match(src, /onClick=\{\(\) => goTo\(k\)\}/, 'a segment steps without holding');
});

test('both sides step, under a click-through content layer', () => {
  assert.match(src, /data-hero-side="prev"/);
  assert.match(src, /data-hero-side="next"/);
  assert.match(src, /data-home-hero-content className="pointer-events-none /);
});
