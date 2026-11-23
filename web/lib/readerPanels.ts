// Panel view (Reader → Panel view): a comic or manga page read one panel at a time, each framed to fill the screen.
//
// The panels come from the server (bff lib/panelDetect.ts, found nightly or on import and carried in the page list); this file is
// only the camera and framing over them. A page the server has not looked at -- or found no panels on -- is shown whole: a wrong
// frame is worse than none. (There used to be a second, in-browser finder reading the page's pixels; it was retired in favour of the
// server's, which is the one that is tuned and reviewed.)

/** A box on a page as fractions of it: left, top, width, height. The whole page is { x: 0, y: 0, w: 1, h: 1 }. */
export interface Box { x: number; y: number; w: number; h: number }

export const WHOLE_PAGE: Box = { x: 0, y: 0, w: 1, h: 1 };

/** Two panels' edges may overlap by this share of the page and still be read as one above or beside the other. */
const ORDER_SLACK = 0.06;
/** One panel this much of the page beside others is a dominant element -- a splash with insets -- shown whole first. */
const OVERVIEW_DOMINANT = 0.55;
/** A page wider than this (width over height) is a double-page spread. */
export const SPREAD_ASPECT = 1.15;

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
export function cameraOf(box: Box, page: { x: number; y: number; w: number; h: number }, view: { w: number; h: number }, maxScale = Infinity): { s: number; x: number; y: number } {
  if (!(page.w > 0 && page.h > 0 && view.w > 0 && view.h > 0)) return { s: 1, x: 0, y: 0 };
  const s = Math.max(0.05, Math.min(maxScale, MAX_SCALE * (view.w / page.w), (view.w * (1 - 2 * MARGIN)) / (box.w * page.w), (view.h * (1 - 2 * MARGIN)) / (box.h * page.h)));
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
export function framingPanels(panels: Box[], page: { x: number; y: number; w: number; h: number }, view: { w: number; h: number }, cap = Infinity): { kept: Box[]; skipped: number } {
  const whole = cameraOf(WHOLE_PAGE, page, view).s;
  const kept = panels.filter((b) => cameraOf(b, page, view, cap).s >= whole * MIN_ZOOM);
  return { kept, skipped: panels.length - kept.length };
}

// ---- how much zoom the lettering needs ----

/** The height of a comfortable letter on a phone, in CSS pixels: the default of Reader → Comfortable text size. */
export const DEFAULT_COMFORT_PX = 8.5;
/** A frame goes this much past the zoom that just makes the lettering comfortable: a little room, not a magnifying glass. */
const COMFORT_HEADROOM = 1.15;

/**
 * The most a panel frame should zoom, from how large the page's lettering is. `textH` is the height of a letter as a share of the
 * page's WIDTH (the server measures it, bff lib/panelDetect.ts glyphHeight); the page is drawn `viewW` wide at scale 1, so a letter is
 * `textH * viewW` CSS pixels there, and `comfortPx / (textH * viewW)` is the zoom that makes it comfortable. A page whose lettering
 * is legible already comes out near or below the whole page's own scale, which `framingPanels` reads as "nothing to zoom for".
 * Infinity when the lettering was not measured: zoom to fit the panel, as before.
 */
export function legibleCap(textH: number | null | undefined, viewW: number, comfortPx = DEFAULT_COMFORT_PX): number {
  if (!(textH && textH > 0 && viewW > 0 && comfortPx > 0)) return Infinity;
  return (comfortPx / (textH * viewW)) * COMFORT_HEADROOM;
}

/** Boxes (page fractions) in reading order: a row left to right, or right to left for manga, rows top to bottom. */
export function orderBoxes(boxes: Box[], rtl: boolean): Box[] {
  const placed = boxes.map((b) => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h, b }));
  return orderPanels(placed, 1, 1, rtl).map((p) => p.b);
}

/** A server answer's boxes ([x, y, w, h] page fractions) as boxes in reading order, and whether the page opens whole before them. */
export function serverPanels(raw: number[][] | undefined, rtl: boolean, aspect: number | null): { panels: Box[]; overview: boolean } {
  const boxes = (raw ?? []).filter((r) => r.length === 4).map(([x, y, w, h]) => ({ x, y, w, h }));
  if (boxes.length < 2) return { panels: [], overview: false };
  const dominant = Math.max(...boxes.map((b) => b.w * b.h)) > OVERVIEW_DOMINANT;
  return { panels: orderBoxes(boxes, rtl), overview: (aspect != null && aspect > SPREAD_ASPECT) || dominant };
}
