import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPanels, analyzePage, cameraOf, framingPanels, legibleCap, orderBoxes, serverPanels } from '../lib/readerPanels';

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
const W = 400, H = 600, M = 14, G = 10; // gutters are ~2.5 % of the page, as a drawn page's are

test('a page of four panels is found in reading order', () => {
  const px = page(W, H, [[M, M, W / 2 - G / 2, H / 2 - G / 2], [W / 2 + G / 2, M, W - M, H / 2 - G / 2], [M, H / 2 + G / 2, W / 2 - G / 2, H - M], [W / 2 + G / 2, H / 2 + G / 2, W - M, H - M]]);
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
  const px = page(W, H, [[M, M, W / 2 - G / 2, H - M], [W / 2 + G / 2, M, W - M, H / 2 - G / 2], [W / 2 + G / 2, H / 2 + G / 2, W - M, H - M]]);
  const p = findPanels(px, W, H, false);
  assert.equal(p.length, 3);
  assert.ok(p[0].h > 0.9, 'the tall one stays whole');
  const m = findPanels(px, W, H, true);
  assert.ok(m[0].x > 0.4 && m[0].y < 0.1 && m[1].y > 0.4, 'manga reads the right column down, then the left');
});

test('rows of unequal columns', () => {
  const px = page(W, H, [[M, M, W - M, 180], [M, 190, 120, H - M], [130, 190, W - M, H - M]]);
  assert.equal(findPanels(px, W, H, false).length, 3);
});

test('a splash page has no panels', () => {
  assert.deepEqual(findPanels(page(W, H, [[0, 0, W, H]]), W, H), []);
  assert.deepEqual(findPanels(page(W, H, [[M, M, W - M, H - M]]), W, H), []);
});

test('a blank page and a tiny image have none', () => {
  assert.deepEqual(findPanels(page(W, H, []), W, H), []);
  assert.deepEqual(findPanels(new Uint8ClampedArray(4 * 4 * 4), 4, 4), []);
});

test('a page on black paper is read the same way', () => {
  const px = page(W, H, [[M, M, W / 2 - G / 2, H - M], [W / 2 + G / 2, M, W - M, H - M]], 0);
  assert.equal(findPanels(px, W, H, false).length, 2);
});

test('a page number below the panels is not a panel', () => {
  const px = page(W, H, [[M, M, W / 2 - G / 2, 270], [W / 2 + G / 2, M, W - M, 270], [M, 280, W - M, 560], [190, 578, 210, 594]]);
  assert.equal(findPanels(px, W, H, false).length, 3);
});

test('pure white along a panel\'s side is not part of it', () => {
  // Two panels whose art sits well in from their (white) edges: the boxes are the art.
  const px = page(W, H, [[60, 60, 180, 540], [220, 60, 340, 540]]);
  const p = findPanels(px, W, H, false);
  assert.equal(p.length, 2);
  assert.ok(p[0].x > 0.13 && p[0].x < 0.18, `left box starts at the art, not the margin: ${p[0].x}`);
  assert.ok(p[1].x + p[1].w < 0.87 && p[1].x + p[1].w > 0.83, 'and the right one ends at it');
});

test('a figure over the gap between panels leaves them two panels, each framing the figure', () => {
  // Two panels one above the other, with a figure (a block of art) drawn across the gutter between them.
  const px = page(W, H, [[M, M, W - M, 290], [M, 300, W - M, H - M], [150, 270, 230, 330]]);
  const p = findPanels(px, W, H, false);
  assert.equal(p.length, 2, 'two panels, not one glued by the figure');
  assert.ok(p[0].y + p[0].h > 0.5 - 0.012, 'the upper frame reaches into the gap the figure fills');
  assert.ok(p[1].y < 0.5 + 0.012, 'and so does the lower one');
});

test('boxes that overlap are both kept', () => {
  // Two panels side by side with a figure drawn across the gutter: their frames overlap over it.
  const px = page(W, H, [[M, M, 195, H - M], [205, M, W - M, H - M], [175, 250, 225, 400]]);
  const p = findPanels(px, W, H, false);
  assert.equal(p.length, 2);
  assert.ok(p[0].x + p[0].w > p[1].x, 'the two boxes overlap');
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
  const px = page(W, H, [[M, M, W / 2 - G / 2, H / 2 - G / 2], [W / 2 + G / 2, M, W - M, H / 2 - G / 2], [M, H / 2 + G / 2, W / 2 - G / 2, H - M], [W / 2 + G / 2, H / 2 + G / 2, W - M, H - M]]);
  assert.equal(analyzePage(px, W, H).overview, false);
});

test('a double-page spread is shown whole before its panels', () => {
  const w = 800, h = 600;
  const px = page(w, h, [[M, M, 390, 290], [410, M, w - M, 290], [M, 310, 390, h - M], [410, 310, w - M, h - M]]);
  const a = analyzePage(px, w, h);
  assert.equal(a.panels.length, 4);
  assert.equal(a.overview, true);
});

test('one big panel beside small ones is shown whole first', () => {
  const px = page(W, H, [[M, M, W - M, 420], [M, 430, 190, H - M], [210, 430, W - M, H - M]]);
  const a = analyzePage(px, W, H);
  assert.equal(a.panels.length, 3);
  assert.equal(a.overview, true);
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

test('how far to zoom follows how big the lettering is', () => {
  // Lettering 1.7 % of the page's width on a 390 px phone is 6.6 px a letter; 8.5 px is comfortable: about 1.29x, with a little room.
  const cap = legibleCap(0.0169, 390, 8.5);
  assert.ok(cap > 1.4 && cap < 1.6, `cap ${cap}`);
  // Unmeasured lettering: no cap, zoom to fit.
  assert.equal(legibleCap(null, 390), Infinity);
  assert.equal(legibleCap(0, 390), Infinity);
  // A wider screen shows the same page's letters larger, so it needs less zoom.
  assert.ok(legibleCap(0.0169, 600, 8.5) < cap);
});

test('a page that reads comfortably already has no frames to zoom into; small lettering gets a moderate zoom', () => {
  const view = { w: 390, h: 844 };
  const page = { x: 0, y: 0, w: 390, h: 585 };
  const grid = [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];
  // Lettering 3.5 % of the width is 13.7 px on this phone: legible at once.
  assert.deepEqual(framingPanels(grid, page, view, legibleCap(0.035, 390, 8.5)), { kept: [], skipped: 4 });
  // 1.7 % is 6.6 px: the frames are kept, and zoom only to the comfortable size, not to fill the screen with a quarter-page.
  const small = legibleCap(0.0169, 390, 8.5);
  assert.equal(framingPanels(grid, page, view, small).kept.length, 4);
  const filled = cameraOf(grid[0], page, view).s;
  const comfy = cameraOf(grid[0], page, view, small).s;
  assert.ok(comfy < filled, 'capped below filling the screen');
  assert.ok(Math.abs(comfy - small) < 1e-9, 'at the comfortable zoom');
});

test('a panel too big to reach the comfortable zoom still fits the screen', () => {
  const view = { w: 390, h: 844 };
  const page = { x: 0, y: 0, w: 390, h: 585 };
  const wide = { x: 0, y: 0, w: 1, h: 0.45 };
  const cap = legibleCap(0.0169, 390, 8.5) * 3; // lettering needing far more zoom than the panel can give
  assert.equal(cameraOf(wide, page, view, cap).s, cameraOf(wide, page, view).s);
});

test('server panels are put in reading order for the series\' direction', () => {
  const raw = [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
  assert.deepEqual(serverPanels(raw, false, 0.67).panels.map((b) => [b.x, b.y]), [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]);
  assert.deepEqual(serverPanels(raw, true, 0.67).panels.map((b) => [b.x, b.y]), [[0.5, 0], [0, 0], [0.5, 0.5], [0, 0.5]]);
  assert.equal(serverPanels(raw, false, 0.67).overview, false);
  assert.equal(serverPanels(raw, false, 1.4).overview, true, 'a spread opens whole');
  assert.deepEqual(serverPanels([[0, 0, 1, 1]], false, 0.67), { panels: [], overview: false }, 'one box is no panels');
  assert.deepEqual(serverPanels(undefined, false, null), { panels: [], overview: false });
  assert.equal(orderBoxes([], false).length, 0);
});
