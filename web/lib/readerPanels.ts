// Panel view (Reader → Panel view): a comic or manga page read one panel at a time, each framed to fill the screen.
//
// Nothing is stored and nothing is asked of the server: the panels are found here, from the page's own pixels, the way
// lib/readerCrop.ts finds its margins. A page whose gutters cannot be told -- a splash, full-bleed art, a layout of
// diagonals -- has NO panels, and the reader shows it whole; a wrong frame is worse than none.

/** A box on a page as fractions of it: left, top, width, height. The whole page is { x: 0, y: 0, w: 1, h: 1 }. */
export interface Box { x: number; y: number; w: number; h: number }

export const WHOLE_PAGE: Box = { x: 0, y: 0, w: 1, h: 1 };

/** A pixel is ink when its brightness is this far from the paper's. */
const INK = 48;
/** A row or column is gutter when no more than this share of it is ink: a speech balloon's tail is not a panel border. */
const GUTTER_INK = 0.02;
/** The narrowest gutter, as a share of the page's width (for a vertical one) or height: a hairline inside art is not one. */
const MIN_GUTTER = 0.012;
/** The paper must fill this share of the page's outer ring, or the page runs to its edges and has no gutters to find. */
const PAPER_RING = 0.5;
/** A panel narrower or shorter than this share of the page is a fragment (a page number, a caption), not a panel. */
const MIN_W = 0.06;
const MIN_H = 0.04;
/** Panels together fill less than this share of the page: the "gutters" were holes in art. */
const MIN_COVERAGE = 0.4;
const MAX_PANELS = 14;
const MAX_DEPTH = 6;
/** What a frame keeps around its panel, as a share of the page. */
const PAD = 0.008;

/**
 * The panels of a page in reading order, from its pixels (`rgba`, `w` x `h`, as a canvas's getImageData gives them).
 * `rtl`: a row reads right to left (manga). Empty when the page has fewer than two panels worth framing.
 *
 * Cuts the page along its gutters, as a guillotine would: the paper is what the outer ring of the page is (white or
 * black); a row with next to no ink across a region is a gutter, and the region is cut at every gutter of the first
 * direction that has one -- rows before columns, so a tall panel beside two short ones is found whole -- and each piece
 * cut again. A piece with no gutter is a panel, trimmed to its ink.
 */
export function findPanels(rgba: ArrayLike<number>, w: number, h: number, rtl = false): Box[] {
  if (!(w >= 16 && h >= 16) || rgba.length < w * h * 4) return [];
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) lum[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];

  const paper = paperOf(lum, w, h);
  if (paper == null) return [];
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = Math.abs(lum[i] - paper) > INK ? 1 : 0;

  const minGutterX = Math.max(2, Math.round(w * MIN_GUTTER));
  const minGutterY = Math.max(2, Math.round(h * MIN_GUTTER));
  const out: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];

  const cut = (x0: number, y0: number, x1: number, y1: number, depth: number) => {
    const t = trim(ink, w, x0, y0, x1, y1);
    if (!t) return;
    [x0, y0, x1, y1] = t;
    if (depth < MAX_DEPTH) {
      const rows = pieces(ink, w, x0, y0, x1, y1, 'y', minGutterY);
      if (rows.length > 1) { for (const [a, b] of rows) cut(x0, a, x1, b, depth + 1); return; }
      const cols = pieces(ink, w, x0, y0, x1, y1, 'x', minGutterX);
      if (cols.length > 1) { for (const [a, b] of (rtl ? cols.reverse() : cols)) cut(a, y0, b, y1, depth + 1); return; }
    }
    out.push({ x0, y0, x1, y1 });
  };
  cut(0, 0, w, h, 0);

  const panels = out.filter((p) => (p.x1 - p.x0) / w >= MIN_W && (p.y1 - p.y0) / h >= MIN_H && density(ink, w, p) > 0.003);
  if (panels.length < 2 || panels.length > MAX_PANELS) return [];
  const area = panels.reduce((s, p) => s + ((p.x1 - p.x0) * (p.y1 - p.y0)) / (w * h), 0);
  if (area < MIN_COVERAGE) return [];
  return panels.map((p) => {
    const x = Math.max(0, p.x0 / w - PAD);
    const y = Math.max(0, p.y0 / h - PAD);
    return { x, y, w: Math.min(1, p.x1 / w + PAD) - x, h: Math.min(1, p.y1 / h + PAD) - y };
  });
}

/** The paper's brightness: white or black, whichever fills at least half the page's outer ring; null for neither. */
function paperOf(lum: Uint8Array, w: number, h: number): number | null {
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.02));
  let light = 0, dark = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) { x = w - ring - 1; continue; }
      const v = lum[y * w + x];
      if (v >= 215) light++; else if (v <= 40) dark++;
      n++;
    }
  }
  if (light / n >= PAPER_RING && light >= dark) return 255;
  if (dark / n >= PAPER_RING) return 0;
  return null;
}

/** The ink-bearing extent of a region: its first and last row and column with ink in them. null when it has none. */
function trim(ink: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
  const rowInk = (y: number) => { let c = 0; for (let x = x0; x < x1; x++) c += ink[y * w + x]; return c / (x1 - x0); };
  const colInk = (x: number) => { let c = 0; for (let y = y0; y < y1; y++) c += ink[y * w + x]; return c / (y1 - y0); };
  let a = y0, b = y1, c = x0, d = x1;
  while (a < b && rowInk(a) <= GUTTER_INK) a++;
  while (b > a && rowInk(b - 1) <= GUTTER_INK) b--;
  while (c < d && colInk(c) <= GUTTER_INK) c++;
  while (d > c && colInk(d - 1) <= GUTTER_INK) d--;
  return a < b && c < d ? [c, a, d, b] : null;
}

/** The runs of a region between its gutters along `axis` (the rows for 'y'), a gutter being `min` or more clear lines. */
function pieces(ink: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number, axis: 'x' | 'y', min: number): Array<[number, number]> {
  const lo = axis === 'y' ? y0 : x0;
  const hi = axis === 'y' ? y1 : x1;
  const across = axis === 'y' ? x1 - x0 : y1 - y0;
  const clear = (i: number) => {
    let c = 0;
    if (axis === 'y') for (let x = x0; x < x1; x++) c += ink[i * w + x];
    else for (let y = y0; y < y1; y++) c += ink[y * w + i];
    return c / across <= GUTTER_INK;
  };
  const runs: Array<[number, number]> = [];
  let start = lo;
  let i = lo;
  while (i < hi) {
    if (!clear(i)) { i++; continue; }
    let j = i;
    while (j < hi && clear(j)) j++;
    if (j - i >= min && i > lo && j < hi) { runs.push([start, i]); start = j; }
    i = j;
  }
  runs.push([start, hi]);
  return runs;
}

function density(ink: Uint8Array, w: number, p: { x0: number; y0: number; x1: number; y1: number }): number {
  let c = 0;
  for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) c += ink[y * w + x];
  return c / Math.max(1, (p.x1 - p.x0) * (p.y1 - p.y0));
}

/** The panels of a loaded page, read from a copy at most 320 px wide and 1,280 rows tall. [] when it has none or cannot be read back (a tainted canvas). */
export function panelsOfImage(img: HTMLImageElement, rtl: boolean): Box[] {
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (!w0 || !h0) return [];
  const k = Math.min(1, 320 / w0, 1280 / h0);
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, w, h);
    return findPanels(ctx.getImageData(0, 0, w, h).data, w, h, rtl);
  } catch {
    return [];
  }
}

// ---- framing ----

/** The largest a frame zooms the page, relative to the page fitted to the screen's width: past it a small panel is a smear. */
const MAX_SCALE = 4;
/** What a frame leaves round its panel, as a share of the screen. */
const MARGIN = 0.03;

/**
 * Where to put a page so `box` of it fills a `vw` x `vh` screen: the size the whole page is drawn at, and the offset of
 * its top left corner. The page is first fitted to the screen's width, then scaled so the box just fits.
 */
export function frameOf(box: Box, page: { w: number; h: number }, view: { w: number; h: number }): { width: number; height: number; x: number; y: number } {
  if (!(page.w > 0 && page.h > 0 && view.w > 0 && view.h > 0)) return { width: view.w, height: view.h, x: 0, y: 0 };
  const baseW = view.w;
  const baseH = view.w * (page.h / page.w);
  const s = Math.max(0.05, Math.min(MAX_SCALE, (view.w * (1 - 2 * MARGIN)) / (box.w * baseW), (view.h * (1 - 2 * MARGIN)) / (box.h * baseH)));
  const width = baseW * s;
  const height = baseH * s;
  return { width, height, x: view.w / 2 - (box.x + box.w / 2) * width, y: view.h / 2 - (box.y + box.h / 2) * height };
}
