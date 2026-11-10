import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPanels, analyzePage, cameraOf, framingPanels } from '../lib/readerPanels';

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

test('a panel is framed to fill the screen, wherever its page lies in the world', () => {
  const view = { w: 400, h: 800 };
  const page = { x: -1236, y: 0, w: 400, h: 600 };
  const box = { x: 0, y: 0, w: 0.5, h: 0.25 };
  const c = cameraOf(box, page, view);
  assert.ok(Math.abs(c.s - 0.94 / 0.5) < 1e-9, 'fitted to the width, with the 3 % margins');
  // The box's centre lands on the screen's centre.
  assert.ok(Math.abs(c.x + (page.x + 0.25 * page.w) * c.s - 200) < 1e-6);
  assert.ok(Math.abs(c.y + (page.y + 0.125 * page.h) * c.s - 400) < 1e-6);
  // The whole page contains in the screen.
  const all = cameraOf({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 400, h: 1200 }, { w: 400, h: 800 });
  assert.ok(all.s * 1200 <= 800 && all.s * 400 <= 400);
});

test('Panel view is a device setting, off until chosen', async () => {
  const { DEFAULT_DEVICE, migrateDevicePrefs } = await import('../lib/readerDevice');
  assert.equal(DEFAULT_DEVICE.panelView, false);
  assert.equal(migrateDevicePrefs({}).panelView, false);
  assert.equal(migrateDevicePrefs({ panelView: 'yes' }).panelView, false);
  assert.equal(migrateDevicePrefs({ panelView: true }).panelView, true);
});

test('an ordinary page of panels opens on its first panel', () => {
  const px = page(W, H, [[10, 10, 95, 145], [105, 10, 190, 145], [10, 155, 95, 290], [105, 155, 190, 290]]);
  assert.equal(analyzePage(px, W, H).overview, false);
});

test('a double-page spread is shown whole before its panels', () => {
  const w = 400, h = 300;
  const px = page(w, h, [[10, 10, 195, 140], [205, 10, 390, 140], [10, 150, 195, 290], [205, 150, 390, 290]]);
  const a = analyzePage(px, w, h);
  assert.equal(a.panels.length, 4);
  assert.equal(a.overview, true);
});

test('one big panel beside small ones is shown whole first', () => {
  const px = page(W, H, [[10, 10, 190, 200], [10, 210, 95, 290], [105, 210, 190, 290]]);
  const a = analyzePage(px, W, H);
  assert.equal(a.panels.length, 3);
  assert.equal(a.overview, true);
});

test('a figure crossing the gutter between panels shows the page whole first', () => {
  // Four panels, with a figure 15 px wide reaching across the gap between the rows on the left only.
  const rects: R[] = [[10, 10, 95, 140], [105, 10, 190, 140], [10, 160, 95, 290], [105, 160, 190, 290], [40, 130, 55, 170]];
  const a = analyzePage(page(W, H, rects), W, H);
  assert.equal(a.panels.length, 3);
  assert.equal(a.overview, true);
});

test('a quiet strip inside a lone panel does not make a page open whole', () => {
  const rects: R[] = [[10, 10, 190, 100], [10, 110, 95, 290], [105, 110, 190, 290]];
  const px = page(W, H, rects);
  // A blank band across the lower left panel, with no gutter beside it to line up with.
  for (let y = 180; y < 200; y++) for (let x = 12; x < 93; x++) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 255; }
  assert.equal(analyzePage(px, W, H).overview, false);
});

test('panels that only slide the camera up and down the page are not framed', () => {
  const view = { w: 400, h: 800 };
  const page = { x: 0, y: 0, w: 400, h: 600 };
  // Three strips the page's full width: no zoom to be had.
  const strips = [{ x: 0, y: 0.02, w: 1, h: 0.3 }, { x: 0, y: 0.35, w: 1, h: 0.3 }, { x: 0, y: 0.68, w: 1, h: 0.3 }];
  assert.deepEqual(framingPanels(strips, page, view), { kept: [], skipped: 3 });
  // A grid of four: each is zoomed in on by about 2x.
  const grid = [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];
  assert.equal(framingPanels(grid, page, view).kept.length, 4);
  // A wide strip beside two small panels: the strip is skipped, the small ones are kept.
  const mixed = [{ x: 0, y: 0, w: 1, h: 0.4 }, { x: 0, y: 0.45, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.45, w: 0.5, h: 0.5 }];
  assert.deepEqual([framingPanels(mixed, page, view).kept.length, framingPanels(mixed, page, view).skipped], [2, 1]);
});
