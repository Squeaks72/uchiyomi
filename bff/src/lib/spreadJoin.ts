import sharp from 'sharp';

/**
 * Finding spreads that a source cut in two. A double-page spread scanned as two portrait images has one picture
 * running across the seam: the inner edge of one page and the inner edge of the next carry the same lines at the
 * same heights. Two unrelated pages almost never do, and a blank or solid edge says nothing either way, so only
 * edges with something drawn on them count.
 */

const ROWS = 160;
/** Outer pixels of a page averaged into its edge, at the measured size. */
const BAND = 2;

export interface EdgeProfile {
  width: number;
  height: number;
  /** ROWS grey values down the left / right edge, 0 to 255. */
  left: Float32Array;
  right: Float32Array;
}

export async function edgeProfile(bytes: Buffer): Promise<EdgeProfile | null> {
  try {
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return null;
    // Only a manga-shaped portrait can be half of a spread; skip the (costly, for a webtoon strip) resize for the rest.
    if (meta.width >= meta.height || meta.height / meta.width > SEAM.maxAspect) {
      return { width: meta.width, height: meta.height, left: new Float32Array(0), right: new Float32Array(0) };
    }
    const w = Math.max(8, Math.round((meta.width / meta.height) * ROWS));
    const { data } = await sharp(bytes).greyscale().resize(w, ROWS, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const left = new Float32Array(ROWS), right = new Float32Array(ROWS);
    for (let y = 0; y < ROWS; y++) {
      let l = 0, r = 0;
      for (let k = 0; k < BAND; k++) { l += data[y * w + k]; r += data[y * w + w - 1 - k]; }
      left[y] = l / BAND; right[y] = r / BAND;
    }
    return { width: meta.width, height: meta.height, left, right };
  } catch { return null; }
}

const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: Float32Array) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

/** How well two edges continue one picture: mean absolute difference and correlation, plus how much is drawn on each. */
export function seam(a: Float32Array, b: Float32Array): { mad: number; corr: number; sdA: number; sdB: number } {
  const sdA = sd(a), sdB = sd(b);
  let mad = 0, cov = 0;
  const ma = mean(a), mb = mean(b);
  for (let i = 0; i < a.length; i++) { mad += Math.abs(a[i] - b[i]); cov += (a[i] - ma) * (b[i] - mb); }
  return { mad: mad / a.length, corr: sdA > 0 && sdB > 0 ? cov / a.length / (sdA * sdB) : 0, sdA, sdB };
}

export const SEAM = { minSd: 22, maxMad: 14, minCorr: 0.9, sizeTol: 0.02, maxAspect: 2.0 };

/**
 * Which way the picture runs across the seam from page `a` to the page after it: 'rtl' when a's LEFT edge meets
 * b's RIGHT edge (b sits on the left of the spread), 'ltr' when a's right edge meets b's left. null when neither,
 * or when both do (an edge that matches everything proves nothing).
 */
export function joinDirection(a: EdgeProfile, b: EdgeProfile): 'rtl' | 'ltr' | null {
  if (Math.abs(a.height - b.height) / Math.max(a.height, b.height) > SEAM.sizeTol) return null;
  if (Math.abs(a.width - b.width) / Math.max(a.width, b.width) > SEAM.sizeTol) return null;
  // Manga pages run about 1.4-1.5 tall to wide; a webtoon strip is far taller and its panels butt together by design.
  if (a.width >= a.height || b.width >= b.height) return null;
  if (a.height / a.width > SEAM.maxAspect || b.height / b.width > SEAM.maxAspect) return null;
  const ok = (s: ReturnType<typeof seam>) => s.sdA >= SEAM.minSd && s.sdB >= SEAM.minSd && s.mad <= SEAM.maxMad && s.corr >= SEAM.minCorr;
  const rtl = ok(seam(a.left, b.right)), ltr = ok(seam(a.right, b.left));
  return rtl === ltr ? null : rtl ? 'rtl' : 'ltr';
}

/**
 * For each page, whether it and the page after it are one split spread, and which way. A page that seems to join
 * BOTH its neighbours is a repeating background (the grid behind a Q&A page) or a gradient, not a spread: a page is in
 * at most one spread, so any run of consecutive matches is dropped whole.
 */
export function joinsFor(profiles: Array<EdgeProfile | null>): Array<'rtl' | 'ltr' | null> {
  const raw = profiles.map((p, i) => {
    const n = profiles[i + 1];
    return p && n ? joinDirection(p, n) : null;
  });
  return raw.map((d, i) => (d && !raw[i - 1] && !raw[i + 1] ? d : null));
}

/** Both halves, side by side at the first one's height, as one JPEG. `dir` is joinDirection's: 'rtl' puts `second` on the left. */
export async function stitchSpread(first: Buffer, second: Buffer, dir: 'rtl' | 'ltr'): Promise<Buffer> {
  const [left, right] = dir === 'rtl' ? [second, first] : [first, second];
  const h = (await sharp(first).metadata()).height!;
  const l = await sharp(left).resize({ height: h, fit: 'fill' }).toBuffer({ resolveWithObject: true });
  const r = await sharp(right).resize({ height: h, fit: 'fill' }).toBuffer({ resolveWithObject: true });
  return sharp({ create: { width: l.info.width + r.info.width, height: h, channels: 3, background: '#ffffff' } })
    .composite([{ input: l.data, left: 0, top: 0 }, { input: r.data, left: l.info.width, top: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
