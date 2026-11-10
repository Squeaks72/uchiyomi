import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPanels, frameOf } from '../lib/readerPanels';

type R = [number, number, number, number];
/** A page of `w` x `h`: paper-coloured, with each rect filled with mid-grey "art" (and some black strokes inside). */
function page(w: number, h: number, rects: R[], paper = 255): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = paper; px[i * 4 + 3] = 255; }
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = (x + y) % 7 === 0 ? 0 : paper === 255 ? 90 : 170;
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
  return px;
}
const W = 200, H = 300;

test('a page of four panels is found in reading order', () => {
  const px = page(W, H, [[10, 10, 95, 145], [105, 10, 190, 145], [10, 155, 95, 290], [105, 155, 190, 290]]);
  const ltr = findPanels(px, W, H, false);
  assert.equal(ltr.length, 4);
  assert.ok(ltr[0].x < 0.1 && ltr[0].y < 0.1, 'top left first');
  assert.ok(ltr[1].x > 0.4 && ltr[1].y < 0.1, 'top right second');
  assert.ok(ltr[2].x < 0.1 && ltr[2].y > 0.4, 'bottom left third');
  const rtl = findPanels(px, W, H, true);
  assert.ok(rtl[0].x > 0.4 && rtl[0].y < 0.1, 'manga: top right first');
  assert.ok(rtl[1].x < 0.1 && rtl[1].y < 0.1, 'manga: top left second');
});

test('a tall panel beside two short ones is one panel', () => {
  const px = page(W, H, [[10, 10, 95, 290], [105, 10, 190, 145], [105, 155, 190, 290]]);
  const p = findPanels(px, W, H, false);
  assert.equal(p.length, 3);
  assert.ok(p[0].h > 0.9, 'the tall one stays whole');
  const m = findPanels(px, W, H, true);
  assert.ok(m[0].x > 0.4 && m[0].y < 0.1 && m[1].y > 0.4, 'manga reads the right column down, then the left');
});

test('rows of unequal columns', () => {
  const px = page(W, H, [[10, 10, 190, 100], [10, 110, 60, 290], [70, 110, 190, 290]]);
  assert.equal(findPanels(px, W, H, false).length, 3);
});

test('a splash page has no panels', () => {
  assert.deepEqual(findPanels(page(W, H, [[0, 0, W, H]]), W, H), []);
  assert.deepEqual(findPanels(page(W, H, [[10, 10, 190, 290]]), W, H), []);
});

test('a blank page and a tiny image have none', () => {
  assert.deepEqual(findPanels(page(W, H, []), W, H), []);
  assert.deepEqual(findPanels(new Uint8ClampedArray(4 * 4 * 4), 4, 4), []);
});

test('a page on black paper is read the same way', () => {
  const px = page(W, H, [[10, 10, 95, 290], [105, 10, 190, 290]], 0);
  assert.equal(findPanels(px, W, H, false).length, 2);
});

test('a page number below the panels is not a panel', () => {
  const px = page(W, H, [[10, 10, 95, 140], [105, 10, 190, 140], [10, 150, 190, 275], [95, 288, 105, 297]]);
  assert.equal(findPanels(px, W, H, false).length, 3);
});

test('a panel is framed to fill the screen', () => {
  const f = frameOf({ x: 0, y: 0, w: 0.5, h: 0.25 }, { w: 1000, h: 1500 }, { w: 400, h: 800 });
  // Fitted to the width: 0.5 of a 400 px page is 200, doubled to ~376 (3 % margins).
  assert.ok(Math.abs(f.width - 400 * (0.94 / 0.5)) < 1);
  // Its centre is the screen's centre.
  assert.ok(Math.abs(f.x + 0.25 * f.width - 200) < 1e-6 && Math.abs(f.y + 0.125 * f.height - 400) < 1e-6);
  // The whole page contains in the screen.
  const all = frameOf({ x: 0, y: 0, w: 1, h: 1 }, { w: 1000, h: 1500 }, { w: 400, h: 400 });
  assert.ok(all.height <= 400 && all.width <= 400);
});

test('Panel view is a device setting, off until chosen', async () => {
  const { DEFAULT_DEVICE, migrateDevicePrefs } = await import('../lib/readerDevice');
  assert.equal(DEFAULT_DEVICE.panelView, false);
  assert.equal(migrateDevicePrefs({}).panelView, false);
  assert.equal(migrateDevicePrefs({ panelView: 'yes' }).panelView, false);
  assert.equal(migrateDevicePrefs({ panelView: true }).panelView, true);
});
