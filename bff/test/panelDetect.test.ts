import test, { before } from 'node:test';
import assert from 'node:assert/strict';

// panelJob reaches the db module on import, which refuses to load without a DSN; nothing here touches the database.
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

import { decode, letterHeights, nms, orderBoxes, tidy, TIERS, TIER_ORDER } from '../src/lib/panelDetect';
import type { PanelSettings } from '../src/lib/panelJob';
let nextTier: typeof import('../src/lib/panelJob').nextTier;
let nightlyDue: typeof import('../src/lib/panelJob').nightlyDue;
before(async () => { ({ nextTier, nightlyDue } = await import('../src/lib/panelJob')); });

// ---- the network's output ----

test('decode reads a YOLOv8 head into page fractions, undoing the padding', () => {
  // Two candidates in a [4 + 4 classes, N = 2] tensor for a 640x960 page: a panel of class 2 and a balloon of class 3.
  const n = 2;
  const d = new Float32Array(8 * n);
  const set = (row: number, i: number, v: number) => { d[row * n + i] = v; };
  // candidate 0: centre (320, 240), 640 x 480 -> the top half of the page
  set(0, 0, 320); set(1, 0, 240); set(2, 0, 640); set(3, 0, 480); set(6, 0, 0.9);
  // candidate 1: the same place, but it is a text box (class 3)
  set(0, 1, 320); set(1, 1, 240); set(2, 1, 640); set(3, 1, 480); set(7, 1, 0.8);
  const frames = decode(d, n, 2, 0.36, 640, 960);
  assert.equal(frames.length, 1);
  assert.deepEqual([frames[0].x, frames[0].y, frames[0].w, frames[0].h], [0, 0, 1, 0.5]);
  const texts = decode(d, n, 3, 0.3, 640, 960);
  assert.equal(texts.length, 1);
});

test('decode clamps a box that runs off the page and drops one entirely off it', () => {
  const d = new Float32Array([700, 100, 400, 80, 0.9, /* wait: [4+1 classes, N=1] */]);
  const f = decode(Float32Array.from([700, 100, 400, 80, 0.9]), 1, 0, 0.3, 640, 960);
  assert.equal(f.length, 1);
  assert.ok(f[0].x + f[0].w <= 1 + 1e-9, 'kept inside the page');
  assert.equal(decode(Float32Array.from([900, 100, 100, 80, 0.9]), 1, 0, 0.3, 640, 960).length, 0, 'wholly outside is dropped');
  void d;
});

test('nms keeps the most confident of overlapping boxes and every separate one', () => {
  const a = { x: 0, y: 0, w: 0.5, h: 0.5, s: 0.9 };
  const b = { x: 0.02, y: 0.02, w: 0.5, h: 0.5, s: 0.6 };
  const c = { x: 0.6, y: 0.6, w: 0.3, h: 0.3, s: 0.5 };
  const k = nms([b, c, a]);
  assert.deepEqual(k.map((x) => x.s), [0.9, 0.5]);
});

test('tidy drops specks and slivers', () => {
  const ok = { x: 0, y: 0, w: 0.4, h: 0.3 };
  assert.equal(tidy([ok, { x: 0, y: 0, w: 0.04, h: 0.04 }, { x: 0, y: 0, w: 0.9, h: 0.02 }]).length, 1);
});

// ---- reading order ----

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
test('orderBoxes reads rows top to bottom and a row left to right, or right to left for manga', () => {
  const grid = [box(0.5, 0.5, 0.45, 0.45), box(0.05, 0.05, 0.45, 0.45), box(0.5, 0.05, 0.45, 0.45), box(0.05, 0.5, 0.45, 0.45)];
  assert.deepEqual(orderBoxes(grid, false).map((b) => [b.x, b.y]), [[0.05, 0.05], [0.5, 0.05], [0.05, 0.5], [0.5, 0.5]]);
  assert.deepEqual(orderBoxes(grid, true).map((b) => [b.x, b.y]), [[0.5, 0.05], [0.05, 0.05], [0.5, 0.5], [0.05, 0.5]]);
});

test('orderBoxes reads a tall panel beside two short ones as a column', () => {
  const tall = box(0.05, 0.05, 0.4, 0.9), a = box(0.5, 0.05, 0.45, 0.43), b = box(0.5, 0.52, 0.45, 0.43);
  assert.deepEqual(orderBoxes([b, a, tall], false), [tall, a, b]);
  assert.deepEqual(orderBoxes([b, a, tall], true), [a, b, tall]);
});

// ---- how big the lettering is ----

test('letterHeights finds letter-sized dark pieces in a crop and ignores specks and long rules', () => {
  const W = 200, H = 100;
  const g = new Uint8Array(W * H).fill(255);
  // five 12-px-tall letters 8 px wide, one speck, and a long thin rule
  for (let k = 0; k < 5; k++) for (let y = 20; y < 32; y++) for (let x = 20 + k * 20; x < 28 + k * 20; x++) g[y * W + x] = 10;
  g[60 * W + 60] = 10;
  for (let x = 10; x < 190; x++) g[80 * W + x] = 10;
  const hs = letterHeights(g, W, 0, 0, W, H, 600);
  assert.equal(hs.length, 5);
  assert.ok(hs.every((h) => h === 12));
});

// ---- tiers and the job ----

test('each tier is a bigger look than the one before', () => {
  const sizes = TIER_ORDER.map((t) => TIERS[t].bytes);
  assert.deepEqual([...sizes].sort((a, b) => a - b), sizes);
  assert.ok(TIERS.fast.size < TIERS.careful.size && TIERS.careful.size < TIERS.thorough.size);
});

test('try harder runs the tier above the highest a page has', () => {
  assert.equal(nextTier({}), 'fast');
  assert.equal(nextTier({ fast: {} }), 'careful');
  assert.equal(nextTier({ fast: {}, careful: {} }), 'thorough');
  assert.equal(nextTier({ fast: {}, careful: {}, thorough: {} }), null);
  assert.equal(nextTier({ careful: {} }), 'thorough', 'a tier skipped does not come back');
});

test('the nightly pass is due in its hour, once a day, and only when switched on', () => {
  const s = (o: Partial<PanelSettings>): PanelSettings => ({ nightly: true, onImport: false, tier: 'fast', hour: 5, lastRun: null, ...o });
  const at = (h: number, d = 10) => new Date(2026, 10, d, h, 7);
  assert.equal(nightlyDue(s({}), at(5)), true);
  assert.equal(nightlyDue(s({}), at(4)), false, 'not before its hour');
  assert.equal(nightlyDue(s({ nightly: false }), at(5)), false, 'not when off');
  assert.equal(nightlyDue(s({ lastRun: at(5) }), at(5)), false, 'not twice in a day');
  assert.equal(nightlyDue(s({ lastRun: at(5, 9) }), at(5)), true, 'again the next day');
});
