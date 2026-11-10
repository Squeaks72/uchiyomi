// Panel view (Reader → Panel view): a comic or manga page read one panel at a time, each framed to fill the screen.
//
// Nothing is stored and nothing is asked of the server: the panels are found here, from the page's own pixels, the way
// lib/readerCrop.ts finds its margins. A page whose gutters cannot be told -- a splash, full-bleed art, a layout of
// diagonals -- has NO panels, and the reader shows it whole; a wrong frame is worse than none.

/** A box on a page as fractions of it: left, top, width, height. The whole page is { x: 0, y: 0, w: 1, h: 1 }. */
export interface Box { x: number; y: number; w: number; h: number }

export const WHOLE_PAGE: Box = { x: 0, y: 0, w: 1, h: 1 };

/** A pixel is paper when its brightness is within this of the page's paper: the gutters, however JPEG-ed. */
const PAPER_TOL = 28;
/** The widest a gutter can be, as a share of the page's short side: wider white than this is not a gutter. */
const THIN_GUTTER = 0.045;
/** A run of paper must be this long, as a share of the page's width (or height), to be a stretch of gutter. */
const LONG_RUN = 0.04;
/** A gutter drawn over for up to this share of the page is still one gutter: the gap is bridged. */
const BRIDGE_GAP = 0.3;
/** The margin along the page's edge that counts as gutter whatever its width, as a share of the page's short side. */
const EDGE_MARGIN = 0.03;
/** A row or column of a region that is this share blank paper is a gap, however wide: nothing is drawn across it. */
const BLANK_SHARE = 0.98;
/** A pixel this bright or more is pure white; a row or column this share white along a box's edge is trimmed from it. */
const PURE_WHITE = 246;
const WHITE_SHARE = 0.97;
/** Never trim more than this share of a box's width or height from one side. */
const TRIM_MAX = 0.4;
/** How far a box may be let out over a gap, as a share of the page. */
const MAX_BLEED = 0.06;
/** A panel is at least this share of the page: smaller is a balloon, a caption, a face in a corner. */
const MIN_PANEL_AREA = 0.025;
/** A pixel is dark below this brightness. */
const DARK = 100;
/** A panel is at least this share dark: below it the box is mostly white -- a balloon, a caption. */
const MIN_DARK = 0.09;
/** A box this much (or more) inside another is a part of it; if also under NEST_SMALLER of its area it is left to it, else the two merge. */
const NEST_SHARE = 0.8;
const NEST_SMALLER = 0.45;
/** Two panels' edges may overlap by this share of the page and still be read as one above or beside the other. */
const ORDER_SLACK = 0.06;
/** A row or column of a region is a gutter when no more than this share of it is art (the rest gutter): a balloon over a border does not undo it. */
const CUTS: Array<[number, number]> = [[0.25, 0], [0.5, 0.09]];
/** ... and is margin, trimmed from a region's edge, when no more than this share is art. */
const TRIM_TOL = 0.15;
/** The narrowest gutter, as a share of the page's width (for a vertical one) or height: a hairline inside art is not one. */
const MIN_GUTTER = 0.012;
/** The paper must fill this share of the page's outer ring, or the page runs to its edges and has no gutters to find. */
const PAPER_RING = 0.5;
/** A panel narrower or shorter than this share of the page is a fragment (a page number, a caption), not a panel. */
const MIN_W = 0.06;
const MIN_H = 0.04;
/** Panels together fill less than this share of the page: the "gutters" were holes in art. */
const MIN_COVERAGE = 0.4;
/** One panel this much of the page beside others is a dominant element -- a splash with insets -- shown whole first. */
const OVERVIEW_DOMINANT = 0.55;
/** A page wider than this (width over height) is a double-page spread. */
export const SPREAD_ASPECT = 1.15;
/** The size a page is read at: wide enough that a thin gutter does not blur to grey. */
export const WORK_W = 640;
export const WORK_H = 1600;
const MAX_PANELS = 14;
const MAX_DEPTH = 6;
/** What a frame keeps around its panel, as a share of the page. */
const PAD = 0.008;

/**
 * The panels of a page in reading order, from its pixels (`rgba`, `w` x `h`, as a canvas's getImageData gives them).
 * `rtl`: a row reads right to left (manga). Empty when the page has fewer than two panels worth framing.
 * See `analyzePage` for how.
 */
export function findPanels(rgba: ArrayLike<number>, w: number, h: number, rtl = false): Box[] {
  return analyzePage(rgba, w, h, rtl).panels;
}

/**
 * A page's panels, and whether it should be shown WHOLE before them (`overview`): a double-page spread, or a page one panel of
 * which takes most of it -- the page is the picture and the panels are in it.
 *
 * 1. The gutters are found as straight lines of white (`gutterMask`), a gutter with something drawn over it bridged -- a body across
 *    the gap does not glue two panels into one.
 * 2. The page is cut along them like a guillotine, rows before columns: a line that is nearly all gutter always; one that is only
 *    mostly gutter where it leaves a panel each side. A blank row, however wide, is a gap too.
 * 3. Each piece is drawn in from the pure white along its sides, and let out over a gap by what was drawn across it; a piece
 *    that is mostly white (a balloon) or tiny is not a panel. Boxes may overlap -- panels do -- and only a box nearly inside
 *    another is left to it.
 * 4. They are put in reading order (`orderPanels`), the right-hand panel first for `rtl`.
 */
export function analyzePage(rgba: ArrayLike<number>, w: number, h: number, rtl = false): { panels: Box[]; overview: boolean } {
  const none = { panels: [] as Box[], overview: false };
  if (!(w >= 16 && h >= 16) || rgba.length < w * h * 4) return none;
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) lum[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];

  const paper = paperOf(lum, w, h);
  if (paper == null) return none;

  // The gutters are the paper that reaches the page's edge: every white pixel joined to the margin by white. Whatever that
  // cannot reach -- the art, its borders, and the white INSIDE it (a balloon, a bright sky) -- is panel. This follows a gutter
  // round a corner or along a diagonal, and keeps a balloon with the panel it is in, where cutting along straight lines
  // took a balloon for a panel and a figure across a gutter for a reason to find none.
  const occluded = new Uint8Array(w * h);
  const gutter = gutterMask(lum, w, h, paper, occluded);
  const art = new Uint8Array(w * h);
  const blank = new Uint8Array(w * h);
  for (let i = 0; i < art.length; i++) {
    art[i] = gutter[i] ? 0 : 1;
    blank[i] = Math.abs(lum[i] - paper) <= PAPER_TOL ? 1 : 0;
  }

  const minGutterX = Math.max(2, Math.round(w * MIN_GUTTER));
  const minGutterY = Math.max(2, Math.round(h * MIN_GUTTER));
  const out: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];

  // Straight cuts along the gutters, as a guillotine would: a row of a region is a gutter when most of it is gutter, rows before
  // columns, every run cut and each piece cut again. A piece with none is a panel.
  const cut = (x0: number, y0: number, x1: number, y1: number, depth: number) => {
    const t = trim(art, blank, w, x0, y0, x1, y1);
    if (!t) return;
    [x0, y0, x1, y1] = t;
    if (depth < MAX_DEPTH) {
      // A line that is nearly all gutter is cut always; one that is only mostly gutter -- a figure over it, a balloon on it --
      // only where what it leaves is a panel each side, never a sliver of the art.
      for (const [tol, share] of CUTS) {
        const rows = pieces(art, blank, w, x0, y0, x1, y1, 'y', minGutterY, tol, Math.round(h * share));
        if (rows.length > 1) { for (const [a, b] of rows) cut(x0, a, x1, b, depth + 1); return; }
        const cols = pieces(art, blank, w, x0, y0, x1, y1, 'x', minGutterX, tol, Math.round(w * share * 1.4));
        if (cols.length > 1) { for (const [a, b] of cols) cut(a, y0, b, y1, depth + 1); return; }
      }
    }
    out.push({ x0, y0, x1, y1 });
  };
  cut(0, 0, w, h, 0);

  // Pure white along a panel's edge is the page, not the panel: each box is drawn in from it, so the frame goes deeper in.
  const trimmed = out.map((p) => trimWhite(lum, w, h, p)).filter((p) => (p.x1 - p.x0) / w >= MIN_W && (p.y1 - p.y0) / h >= MIN_H
    && ((p.x1 - p.x0) * (p.y1 - p.y0)) / (w * h) >= MIN_PANEL_AREA && darkShare(lum, w, p) >= MIN_DARK);
  // Panels may lie over one another -- a figure, a balloon, a panel laid across its neighbour -- so boxes that overlap are KEPT;
  // only a box that is nearly all inside another, or that two cover each other by, is settled. A figure over the gap between two
  // panels belongs to both frames: each box is let out over the gap by what was drawn across it.
  const kept = settle(trimmed).map((p, id) => ({ ...bleed(occluded, w, h, p), id }));
  const ordered = orderPanels(kept, w, h, rtl);
  if (ordered.length < 2 || ordered.length > MAX_PANELS) return none;
  const areas = ordered.map((p) => ((p.x1 - p.x0) * (p.y1 - p.y0)) / (w * h));
  const area = areas.reduce((a, b) => a + b, 0);
  if (area < MIN_COVERAGE) return none;
  const overview = w / h > SPREAD_ASPECT || Math.max(...areas) > OVERVIEW_DOMINANT;
  return { overview, panels: ordered.map((p) => {
    const x = Math.max(0, p.x0 / w - PAD);
    const y = Math.max(0, p.y0 / h - PAD);
    return { x, y, w: Math.min(1, p.x1 / w + PAD) - x, h: Math.min(1, p.y1 / h + PAD) - y };
  }) };
}

/**
 * A box drawn in from the pure white along its sides: from each side, rows or columns that are all but pure white are the page,
 * not the panel. Never more than TRIM_MAX of a side's length -- a panel that is mostly white sky keeps its shape.
 */
function trimWhite<T extends { x0: number; y0: number; x1: number; y1: number }>(lum: Uint8Array, w: number, h: number, p: T): T {
  const white = (v: number) => v >= PURE_WHITE;
  const rowWhite = (y: number, x0: number, x1: number) => { let c = 0; for (let x = x0; x < x1; x++) if (white(lum[y * w + x])) c++; return c / (x1 - x0) >= WHITE_SHARE; };
  const colWhite = (x: number, y0: number, y1: number) => { let c = 0; for (let y = y0; y < y1; y++) if (white(lum[y * w + x])) c++; return c / (y1 - y0) >= WHITE_SHARE; };
  let { x0, y0, x1, y1 } = p;
  const mx = Math.floor((x1 - x0) * TRIM_MAX), my = Math.floor((y1 - y0) * TRIM_MAX);
  let k = 0;
  while (k < my && y0 < y1 - 1 && rowWhite(y0, x0, x1)) { y0++; k++; }
  k = 0;
  while (k < my && y1 - 1 > y0 && rowWhite(y1 - 1, x0, x1)) { y1--; k++; }
  k = 0;
  while (k < mx && x0 < x1 - 1 && colWhite(x0, y0, y1)) { x0++; k++; }
  k = 0;
  while (k < mx && x1 - 1 > x0 && colWhite(x1 - 1, y0, y1)) { x1--; k++; }
  return { ...p, x0, y0, x1, y1 };
}

/** A box let out over the gap beside it by what was drawn across that gap (`occluded`), a few rows or columns at a time. */
function bleed<T extends { x0: number; y0: number; x1: number; y1: number }>(occ: Uint8Array, w: number, h: number, p: T): T {
  let { x0, y0, x1, y1 } = p;
  const maxX = Math.round(w * MAX_BLEED), maxY = Math.round(h * MAX_BLEED);
  const rowHits = (y: number) => { let c = 0; for (let x = p.x0; x < p.x1; x++) c += occ[y * w + x]; return c; };
  const colHits = (x: number) => { let c = 0; for (let y = p.y0; y < p.y1; y++) c += occ[y * w + x]; return c; };
  const needX = Math.max(2, Math.round((p.x1 - p.x0) * 0.03)), needY = Math.max(2, Math.round((p.y1 - p.y0) * 0.03));
  for (let k = 0; k < maxY && y1 < h && rowHits(y1) >= needX; k++) y1++;
  for (let k = 0; k < maxY && y0 > 0 && rowHits(y0 - 1) >= needX; k++) y0--;
  for (let k = 0; k < maxX && x1 < w && colHits(x1) >= needY; k++) x1++;
  for (let k = 0; k < maxX && x0 > 0 && colHits(x0 - 1) >= needY; k++) x0--;
  return { ...p, x0, y0, x1, y1 };
}

/** The share of a box that is dark (ink, or the dark of art): a balloon is mostly white, a panel is not. */
function darkShare(lum: Uint8Array, w: number, p: { x0: number; y0: number; x1: number; y1: number }): number {
  let d = 0;
  for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) if (lum[y * w + x] < DARK) d++;
  return d / Math.max(1, (p.x1 - p.x0) * (p.y1 - p.y0));
}

/**
 * Boxes that lie on one another, settled: one mostly inside a much larger one is a part of it (a balloon's box, an inset)
 * and is left to it -- the larger frame has it in view -- and two that cover each other by most of the smaller are one panel.
 */
function settle<T extends { x0: number; y0: number; x1: number; y1: number }>(boxes: T[]): T[] {
  let list = [...boxes];
  const area = (b: T) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const inter = (a: T, b: T) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  for (let again = true; again;) {
    again = false;
    list.sort((a, b) => area(b) - area(a));
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const share = inter(a, b) / area(b);
        if (share < NEST_SHARE) continue;
        if (area(b) < area(a) * NEST_SMALLER) list.splice(j, 1);
        else list.splice(j, 1, { ...a, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }), list.splice(i, 1);
        again = true;
        break outer;
      }
    }
  }
  return list;
}

/**
 * The gutters, as straight lines. A paper pixel is a horizontal gutter when it lies in a long horizontal run of paper (LONG_RUN of
 * the page's width) that is thin -- the pixel is not in a vertical run as tall as THIN_GUTTER of the height, which a patch of sky is --
 * and a vertical gutter the same turned a quarter. Runs, not blobs: the white in the art (a balloon's rim, a highlight, a speed line)
 * is not a long thin straight run, so the mask is not full of holes the way an opening of it was.
 *
 * A gutter with something drawn over it -- a character's body across the gap between two panels -- is not two gutters: along its own
 * direction, a gap of up to BRIDGE_GAP of the page between two runs that each reach LONG_RUN is filled, and the pixels that were art
 * there are gutter, so the panels either side are still two panels.
 */
export function gutterMask(lum: Uint8Array, w: number, h: number, paper: number, occluded?: Uint8Array): Uint8Array {
  const n = w * h;
  const isPaper = new Uint8Array(n);
  for (let i = 0; i < n; i++) isPaper[i] = Math.abs(lum[i] - paper) <= PAPER_TOL ? 1 : 0;
  const longX = Math.max(4, Math.round(w * LONG_RUN));
  const longY = Math.max(4, Math.round(h * LONG_RUN));
  const thickX = Math.max(3, Math.round(w * THIN_GUTTER));
  const thickY = Math.max(3, Math.round(h * THIN_GUTTER));
  // The length of the run of paper through each pixel, along rows and along columns.
  const runX = new Int32Array(n);
  const runY = new Int32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      if (!isPaper[y * w + x]) { x++; continue; }
      let e = x;
      while (e < w && isPaper[y * w + e]) e++;
      for (let i = x; i < e; i++) runX[y * w + i] = e - x;
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h;) {
      if (!isPaper[y * w + x]) { y++; continue; }
      let e = y;
      while (e < h && isPaper[e * w + x]) e++;
      for (let i = y; i < e; i++) runY[i * w + x] = e - y;
      y = e;
    }
  }
  const hz = new Uint8Array(n); // horizontal gutter pixels
  const vt = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (runX[i] >= longX && runY[i] < thickY) hz[i] = 1;
    if (runY[i] >= longY && runX[i] < thickX) vt[i] = 1;
  }
  // Bridge: fill the short gaps between two long stretches of a gutter, along its own direction.
  const gapX = Math.round(w * BRIDGE_GAP);
  const gapY = Math.round(h * BRIDGE_GAP);
  const bridged = new Uint8Array(n);
  bridged.set(hz); // rows first
  for (let y = 0; y < h; y++) {
    let lastEnd = -1;
    for (let x = 0; x < w;) {
      if (!hz[y * w + x]) { x++; continue; }
      let e = x;
      while (e < w && hz[y * w + e]) e++;
      if (e - x >= longX && lastEnd >= 0 && x - lastEnd <= gapX) for (let i = lastEnd; i < x; i++) bridged[y * w + i] = 1;
      if (e - x >= longX) lastEnd = e;
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let lastEnd = -1;
    for (let y = 0; y < h;) {
      if (!vt[y * w + x]) { y++; continue; }
      let e = y;
      while (e < h && vt[e * w + x]) e++;
      if (e - y >= longY && lastEnd >= 0 && y - lastEnd <= gapY) for (let i = lastEnd; i < y; i++) bridged[i * w + x] = 1;
      if (e - y >= longY) lastEnd = e;
      y = e;
    }
  }
  for (let i = 0; i < n; i++) if (vt[i]) bridged[i] = 1;
  // What was drawn over a gutter -- the pixels the bridge filled in: a figure's body across the gap between two panels.
  if (occluded) for (let i = 0; i < n; i++) occluded[i] = bridged[i] && !hz[i] && !vt[i] && !isPaper[i] ? 1 : 0;
  // The margin along the page's edge is gutter whatever its width.
  const edge = Math.max(2, Math.round(Math.min(w, h) * EDGE_MARGIN));
  for (let y = 0; y < h; y++) {
    const nearY = y < edge || y >= h - edge;
    for (let x = 0; x < w; x++) if (isPaper[y * w + x] && (nearY || x < edge || x >= w - edge)) bridged[y * w + x] = 1;
  }
  return bridged;
}

/**
 * The panels in reading order. Cut the set of boxes the way a reader would: if a horizontal line runs between two groups,
 * the upper group is read first; else a vertical one, the right group first when `rtl`; else (interlocking boxes) top to
 * bottom by their tops. A box's edge may overlap its neighbour's by a little: diagonal gutters make boxes overlap.
 */
function orderPanels<T extends { x0: number; y0: number; x1: number; y1: number }>(boxes: T[], w: number, h: number, rtl: boolean): T[] {
  if (boxes.length < 2) return boxes;
  const split = (list: T[], lo: (b: T) => number, hi: (b: T) => number, slack: number): [T[], T[]] | null => {
    const sorted = [...list].sort((a, b) => lo(a) - lo(b));
    let reach = hi(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      if (lo(sorted[i]) >= reach - slack) return [sorted.slice(0, i), sorted.slice(i)];
      reach = Math.max(reach, hi(sorted[i]));
    }
    return null;
  };
  const rows = split(boxes, (b) => b.y0, (b) => b.y1, h * ORDER_SLACK);
  if (rows) return [...orderPanels(rows[0], w, h, rtl), ...orderPanels(rows[1], w, h, rtl)];
  // Mirrored for a right-to-left row, so the same sweep reads it from the right.
  const cols = rtl ? split(boxes, (b) => w - b.x1, (b) => w - b.x0, w * ORDER_SLACK) : split(boxes, (b) => b.x0, (b) => b.x1, w * ORDER_SLACK);
  if (cols) return [...orderPanels(cols[0], w, h, rtl), ...orderPanels(cols[1], w, h, rtl)];
  return [...boxes].sort((a, b) => a.y0 - b.y0 || (rtl ? b.x1 - a.x1 : a.x0 - b.x0));
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
function trim(ink: Uint8Array, blank: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
  // A row is margin when it is mostly gutter, or when it is all blank paper (a wide white margin is not a gutter, but it is not art).
  const rowInk = (y: number) => { let c = 0, e = 0; for (let x = x0; x < x1; x++) { c += ink[y * w + x]; e += blank[y * w + x]; } return e / (x1 - x0) >= BLANK_SHARE ? 0 : c / (x1 - x0); };
  const colInk = (x: number) => { let c = 0, e = 0; for (let y = y0; y < y1; y++) { c += ink[y * w + x]; e += blank[y * w + x]; } return e / (y1 - y0) >= BLANK_SHARE ? 0 : c / (y1 - y0); };
  let a = y0, b = y1, c = x0, d = x1;
  while (a < b && rowInk(a) <= TRIM_TOL) a++;
  while (b > a && rowInk(b - 1) <= TRIM_TOL) b--;
  while (c < d && colInk(c) <= TRIM_TOL) c++;
  while (d > c && colInk(d - 1) <= TRIM_TOL) d--;
  return a < b && c < d ? [c, a, d, b] : null;
}

/** The runs of a region between its gutters along `axis` (the rows for 'y'), a gutter being `min` or more clear lines. */
function pieces(ink: Uint8Array, blank: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number, axis: 'x' | 'y', min: number, tol: number, minPiece = 0): Array<[number, number]> {
  const lo = axis === 'y' ? y0 : x0;
  const hi = axis === 'y' ? y1 : x1;
  const across = axis === 'y' ? x1 - x0 : y1 - y0;
  const clear = (i: number) => {
    let c = 0, e = 0;
    if (axis === 'y') for (let x = x0; x < x1; x++) { c += ink[i * w + x]; e += blank[i * w + x]; }
    else for (let y = y0; y < y1; y++) { c += ink[y * w + i]; e += blank[y * w + i]; }
    return c / across <= tol || e / across >= BLANK_SHARE;
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
  // Pieces shorter than `minPiece` are not panels: the gutter beside one is not taken, and it joins its smaller neighbour.
  while (minPiece > 0 && runs.length > 1) {
    let k = runs.findIndex((r) => r[1] - r[0] < minPiece);
    if (k < 0) break;
    const j = k === 0 ? 1 : k === runs.length - 1 ? k - 1 : (runs[k - 1][1] - runs[k - 1][0] <= runs[k + 1][1] - runs[k + 1][0] ? k - 1 : k + 1);
    const a = Math.min(k, j), b = Math.max(k, j);
    runs.splice(a, 2, [runs[a][0], runs[b][1]]);
  }
  return runs;
}

/** The panels of a loaded page (and whether it opens whole, `analyzePage`), read from a copy at most 640 px wide and 1,600 rows tall. [] when it has none or cannot be read back (a tainted canvas). */
export function panelsOfImage(img: HTMLImageElement, rtl: boolean): { panels: Box[]; overview: boolean } {
  const none = { panels: [] as Box[], overview: false };
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (!w0 || !h0) return none;
  const k = Math.min(1, WORK_W / w0, WORK_H / h0);
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return none;
    ctx.drawImage(img, 0, 0, w, h);
    return analyzePage(ctx.getImageData(0, 0, w, h).data, w, h, rtl);
  } catch {
    return none;
  }
}

// ---- framing ----

/** The largest a frame zooms the page, relative to the page fitted to the screen's width: past it a small panel is a smear. */
const MAX_SCALE = 4;
/** What a frame leaves round its panel, as a share of the screen. */
const MARGIN = 0.03;

/**
 * The camera that puts `box` of a page on a `view` screen: a uniform scale and the offset of the world's origin, as
 * `translate(x, y) scale(s)` from the top left. `page` is the page's place in the world (its left, top and size, the page
 * fitted to the screen's width), so the pages of a chapter can lie side by side and the camera pan across them: one
 * transform moves between any two frames, the pages never changing shape on the way.
 */
export function cameraOf(box: Box, page: { x: number; y: number; w: number; h: number }, view: { w: number; h: number }): { s: number; x: number; y: number } {
  if (!(page.w > 0 && page.h > 0 && view.w > 0 && view.h > 0)) return { s: 1, x: 0, y: 0 };
  const s = Math.max(0.05, Math.min(MAX_SCALE * (view.w / page.w), (view.w * (1 - 2 * MARGIN)) / (box.w * page.w), (view.h * (1 - 2 * MARGIN)) / (box.h * page.h)));
  return { s, x: view.w / 2 - (page.x + (box.x + box.w / 2) * page.w) * s, y: view.h / 2 - (page.y + (box.y + box.h / 2) * page.h) * s };
}

/** A panel frame must zoom in on the whole page's frame by at least this much to be worth a stop. */
export const MIN_ZOOM = 1.3;

/**
 * The panels worth a frame on a screen: those the camera zooms in on, by at least MIN_ZOOM over the whole page's own frame.
 * A page whose panels are strips the full width of the screen has nothing to zoom into -- the camera would only slide up and
 * down a page that is all in view already -- so those are `skipped`, and the reader goes straight on past them. `page` is the
 * page in the world (the page fitted to the screen's width), `view` the screen.
 */
export function framingPanels(panels: Box[], page: { x: number; y: number; w: number; h: number }, view: { w: number; h: number }): { kept: Box[]; skipped: number } {
  const whole = cameraOf(WHOLE_PAGE, page, view).s;
  const kept = panels.filter((b) => cameraOf(b, page, view).s >= whole * MIN_ZOOM);
  return { kept, skipped: panels.length - kept.length };
}
