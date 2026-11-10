import sharp from 'sharp';
import { createWriteStream } from 'fs';
import { mkdir, rename, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * Finding the panels of a comic page with a neural network (Reader → Panel view; Admin → Panel detection).
 *
 * The model is the public `deepghs/manga109_yolo` YOLO family (detects body, face, FRAME -- a panel -- and text), run on the
 * server with onnxruntime-web: WebAssembly, so it runs on the Alpine image as it is (onnxruntime-node ships glibc binaries only,
 * and does not load there even with gcompat). A page takes a fraction of a second at the smallest size.
 *
 * Three tiers, because bigger is not simply better -- the same chapter measured the sizes disagreeing on a quarter of its pages,
 * and one older large model finding fewer panels than the nano one on a plain page -- and because a person asked to be able to say
 * "this is not good enough, try harder". Each tier is a different model AND a different look at the page; the results are kept
 * side by side (lib/panelJob.ts) so the one that is right can be picked:
 *   fast      nano model, 640 px                              ~0.1 s   10 MB
 *   careful   medium model, 1024 px, and its mirror image     ~2 s     80 MB
 *   thorough  large model, 1280 px, and its mirror image      ~5 s    101 MB
 * Weights are not shipped: the first run of a tier downloads its model into CONFIG_DIR/models, once.
 */

export type Tier = 'fast' | 'careful' | 'thorough';
export const TIER_ORDER: readonly Tier[] = ['fast', 'careful', 'thorough'];

export interface TierSpec { version: string; bytes: number; size: number; threshold: number; mirror: boolean }
export const TIERS: Record<Tier, TierSpec> = {
  fast: { version: 'v2023.12.07_n_yv11', bytes: 10_483_947, size: 640, threshold: 0.361, mirror: false },
  careful: { version: 'v2023.12.07_m_yv11', bytes: 80_317_266, size: 1024, threshold: 0.385, mirror: true },
  thorough: { version: 'v2023.12.07_l_yv11', bytes: 101_399_640, size: 1280, threshold: 0.373, mirror: true },
};

/** Bumped when what a tier means changes (its model, its size, its thresholds): a page detected under another is detected again. */
export const PANEL_VERSION = 1;

const MODEL_URL = (version: string) => `https://huggingface.co/deepghs/manga109_yolo/resolve/main/${version}/model.onnx`;
/** The model's classes, in the order of its output channels. */
const CLASS = { frame: 2, text: 3 } as const;
/** Text boxes only need to be found, not exact: they say where the lettering is. */
const TEXT_THRESHOLD = 0.3;
const NMS_IOU = 0.5;
/** A frame smaller than this share of the page is a balloon or a speck, not a panel. */
const MIN_FRAME_AREA = 0.012;

/** A box on a page as fractions of it. */
export interface Box { x: number; y: number; w: number; h: number }
interface Scored extends Box { s: number }

export interface Detection {
  /** The page's size in pixels. */
  width: number;
  height: number;
  /** The panels, in left-to-right reading order (the reader reorders them for a series that reads right to left). */
  boxes: Box[];
  /** The height of the page's lettering as a share of the page's WIDTH, or null when no text was found. */
  textH: number | null;
  ms: number;
}

// ---- model files ----

export function modelDir(): string {
  return join(process.env.PANEL_MODEL_DIR || join(process.env.CONFIG_DIR || '/config', 'models'), 'manga109_yolo');
}
export const modelPath = (tier: Tier) => join(modelDir(), `${TIERS[tier].version}.onnx`);

const downloading = new Map<Tier, Promise<string>>();

/**
 * The path of a tier's model, downloading it first if it is not there. One download per tier at a time; a partial file is never
 * left under the real name (written beside it and renamed), and a file of the wrong size is thrown away and fetched again.
 */
export function ensureModel(tier: Tier): Promise<string> {
  const have = downloading.get(tier);
  if (have) return have;
  const run = (async () => {
    const path = modelPath(tier);
    const want = TIERS[tier].bytes;
    const st = await stat(path).catch(() => null);
    if (st && st.size === want) return path;
    await mkdir(modelDir(), { recursive: true });
    const tmp = `${path}.part`;
    const res = await fetch(MODEL_URL(TIERS[tier].version), { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`the ${tier} model could not be downloaded (${res.status})`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
    const got = (await stat(tmp)).size;
    if (got !== want) { await unlink(tmp).catch(() => {}); throw new Error(`the ${tier} model downloaded as ${got} bytes, expected ${want}`); }
    await rename(tmp, path);
    return path;
  })().finally(() => downloading.delete(tier));
  downloading.set(tier, run);
  return run;
}

/** Whether a tier's model is on disk already (the review screen says what a try-harder will download). */
export async function modelReady(tier: Tier): Promise<boolean> {
  const st = await stat(modelPath(tier)).catch(() => null);
  return !!st && st.size === TIERS[tier].bytes;
}

// ---- inference ----

type Ort = typeof import('onnxruntime-web');
let ortMod: Promise<Ort> | null = null;
function ort(): Promise<Ort> {
  // Loaded on first use: the WebAssembly runtime is large, and a server that never detects a panel should not pay for it.
  return (ortMod ??= import('onnxruntime-web').then((m) => {
    const o = ((m as { default?: Ort }).default ?? m) as Ort;
    o.env.wasm.numThreads = Math.max(1, Number(process.env.PANEL_THREADS) || 1);
    return o;
  }));
}

type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>;
const sessions = new Map<Tier, Promise<Session>>();
async function session(tier: Tier): Promise<Session> {
  let s = sessions.get(tier);
  if (!s) {
    const path = await ensureModel(tier);
    s = ort().then((o) => o.InferenceSession.create(path, { executionProviders: ['wasm'] }));
    sessions.set(tier, s);
    s.catch(() => sessions.delete(tier));
  }
  return s;
}
/** Drop the loaded models (a model is tens of MB of WebAssembly memory; the nightly pass ends with this). */
export function releaseModels(): void { sessions.clear(); }

function iou(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = w * h;
  return i / Math.max(1e-9, a.w * a.h + b.w * b.h - i);
}

/** Non-maximum suppression: the most confident box of each overlapping group. */
export function nms<T extends Scored>(boxes: T[], threshold = NMS_IOU): T[] {
  const sorted = [...boxes].sort((a, b) => b.s - a.s);
  const kept: T[] = [];
  for (const c of sorted) if (kept.every((k) => iou(k, c) < threshold)) kept.push(c);
  return kept;
}

/**
 * Decode a YOLOv8-style head: `data` is [4 + classes, N] -- centre x, centre y, width, height, then a score per class -- for a
 * tensor padded to `inW` x `inH`, of which the page fills the top left `pageW` x `pageH`. Boxes come back as page fractions.
 */
export function decode(data: ArrayLike<number>, n: number, cls: number, threshold: number, pageW: number, pageH: number): Scored[] {
  const out: Scored[] = [];
  for (let i = 0; i < n; i++) {
    const s = data[(4 + cls) * n + i];
    if (s < threshold) continue;
    const w = data[2 * n + i], h = data[3 * n + i];
    const x = (data[i] - w / 2) / pageW, y = (data[n + i] - h / 2) / pageH;
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(1, x + w / pageW), y1 = Math.min(1, y + h / pageH);
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, s });
  }
  return out;
}

async function infer(tier: Tier, rgb: Buffer, pw: number, ph: number, mirror: boolean): Promise<{ frames: Scored[]; texts: Scored[] }> {
  const o = await ort();
  const sess = await session(tier);
  // Padded to a multiple of 32 (the network's stride), the page in the top left corner.
  const W = Math.ceil(pw / 32) * 32, H = Math.ceil(ph / 32) * 32;
  const px = new Float32Array(3 * W * H).fill(114 / 255);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const sx = mirror ? pw - 1 - x : x;
      for (let c = 0; c < 3; c++) px[c * W * H + y * W + x] = rgb[(y * pw + sx) * 3 + c] / 255;
    }
  }
  const res = await sess.run({ images: new o.Tensor('float32', px, [1, 3, H, W]) });
  const out = res[sess.outputNames[0]];
  const n = out.dims[2];
  const spec = TIERS[tier];
  let frames = decode(out.data as Float32Array, n, CLASS.frame, spec.threshold, pw, ph);
  let texts = decode(out.data as Float32Array, n, CLASS.text, TEXT_THRESHOLD, pw, ph);
  if (mirror) {
    const flip = (b: Scored): Scored => ({ ...b, x: 1 - b.x - b.w });
    frames = frames.map(flip);
    texts = texts.map(flip);
  }
  return { frames, texts };
}

/**
 * The panels of a page. `bytes` is the page image as stored. The page is scaled to fit the tier's size, run through the network
 * (and again mirrored, for the tiers that do), the frames of the passes pooled and de-duplicated, and put in reading order.
 */
export async function detectPanels(bytes: Buffer, tier: Tier): Promise<Detection> {
  const t0 = Date.now();
  const spec = TIERS[tier];
  const meta = await sharp(bytes).metadata();
  const width = meta.width ?? 0, height = meta.height ?? 0;
  if (!(width > 0 && height > 0)) throw new Error('the page could not be read');
  const r = Math.min(spec.size / width, spec.size / height, 1.5);
  const pw = Math.max(32, Math.round(width * r)), ph = Math.max(32, Math.round(height * r));
  const rgb = await sharp(bytes).resize(pw, ph, { fit: 'fill' }).removeAlpha().raw().toBuffer();

  const base = await infer(tier, rgb, pw, ph, false);
  let frames = base.frames;
  let texts = base.texts;
  if (spec.mirror) {
    const m = await infer(tier, rgb, pw, ph, true);
    frames = frames.concat(m.frames);
    texts = texts.concat(m.texts);
  }
  const boxes = tidy(nms(frames)).map(({ x, y, w, h }) => ({ x, y, w, h }));
  const textH = await glyphHeight(bytes, nms(texts));
  return { width, height, boxes: orderBoxes(boxes, false), textH, ms: Date.now() - t0 };
}

/** Frames made sound: clamped to the page, and not a speck. */
export function tidy<T extends Box>(boxes: T[]): T[] {
  return boxes.filter((b) => b.w * b.h >= MIN_FRAME_AREA && b.w > 0.05 && b.h > 0.03);
}

// ---- reading order ----

/** Two panels' edges may overlap by this share of the page and still be read as one above or beside the other. */
const ORDER_SLACK = 0.06;

/**
 * Boxes in reading order: if a horizontal line runs between two groups the upper is read first; else a vertical one, the right
 * group first when `rtl`; else (boxes that interlock) top to bottom by their tops. Boxes are page fractions.
 */
export function orderBoxes<T extends Box>(boxes: T[], rtl: boolean): T[] {
  if (boxes.length < 2) return boxes;
  const split = (list: T[], lo: (b: T) => number, hi: (b: T) => number): [T[], T[]] | null => {
    const sorted = [...list].sort((a, b) => lo(a) - lo(b));
    let reach = hi(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      if (lo(sorted[i]) >= reach - ORDER_SLACK) return [sorted.slice(0, i), sorted.slice(i)];
      reach = Math.max(reach, hi(sorted[i]));
    }
    return null;
  };
  const rows = split(boxes, (b) => b.y, (b) => b.y + b.h);
  if (rows) return [...orderBoxes(rows[0], rtl), ...orderBoxes(rows[1], rtl)];
  // Mirrored for a right-to-left row, so the same sweep reads it from the right.
  const cols = rtl ? split(boxes, (b) => 1 - b.x - b.w, (b) => 1 - b.x) : split(boxes, (b) => b.x, (b) => b.x + b.w);
  if (cols) return [...orderBoxes(cols[0], rtl), ...orderBoxes(cols[1], rtl)];
  return [...boxes].sort((a, b) => a.y - b.y || (rtl ? b.x + b.w - (a.x + a.w) : a.x - b.x));
}

// ---- how big the lettering is ----

/** The working width a page is measured at: wide enough that a letter is a dozen pixels, small enough to be quick. */
const GLYPH_WIDTH = 1200;
/** A letter is between these heights, as a share of the page's height; smaller is a speck or a dot, larger is a line or a drawing. */
const GLYPH_MIN = 0.003;
const GLYPH_MAX = 0.04;

/**
 * The height of the page's lettering as a share of the page's WIDTH -- what the reader multiplies by the screen's width to know
 * how large the letters really are on it. Measured inside the text boxes the network found: the ink there is binarised (Otsu),
 * split into connected pieces, and the pieces the size of a letter are the letters; the 60th percentile of their heights, which
 * leans to the tall letters over the dots and strokes. null when no text was found.
 */
export async function glyphHeight(bytes: Buffer, texts: Box[]): Promise<number | null> {
  const big = texts.filter((t) => t.w * t.h >= 0.002);
  if (!big.length) return null;
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) return null;
  const w = Math.min(GLYPH_WIDTH, meta.width);
  const raw = await sharp(bytes).resize({ width: w, withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = raw.info;
  const heights: number[] = [];
  for (const t of big) {
    const x0 = Math.max(0, Math.floor(t.x * W)), y0 = Math.max(0, Math.floor(t.y * H));
    const x1 = Math.min(W, Math.ceil((t.x + t.w) * W)), y1 = Math.min(H, Math.ceil((t.y + t.h) * H));
    heights.push(...letterHeights(raw.data, W, x0, y0, x1, y1, H));
  }
  if (heights.length < 8) return null;
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length * 0.6)] / W;
}

/** The heights, in pixels, of the letter-sized dark pieces inside a crop of a greyscale image. Exported for tests. */
export function letterHeights(gray: ArrayLike<number>, stride: number, x0: number, y0: number, x1: number, y1: number, pageH: number): number[] {
  const w = x1 - x0, h = y1 - y0;
  if (w < 4 || h < 4) return [];
  // Otsu's threshold over the crop.
  const hist = new Array<number>(256).fill(0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[gray[y * stride + x]]++;
  const total = w * h;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sumB = 0, best = 0, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; thr = i; }
  }
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dark[y * w + x] = gray[(y0 + y) * stride + x0 + x] <= thr ? 1 : 0;
  const lo = Math.max(3, Math.round(pageH * GLYPH_MIN)), hi = Math.round(pageH * GLYPH_MAX);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const out: number[] = [];
  for (let s = 0; s < dark.length; s++) {
    if (!dark[s] || seen[s]) continue;
    let minY = h, maxY = 0, minX = w, maxX = 0, n = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      n++;
      if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (dark[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    const ph = maxY - minY + 1, pw = maxX - minX + 1;
    // Letter-sized, and not a long stroke or a ruled line.
    if (ph >= lo && ph <= hi && pw <= hi * 1.6 && n >= 8) out.push(ph);
  }
  return out;
}
