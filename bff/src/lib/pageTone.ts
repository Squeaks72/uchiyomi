import sharp from 'sharp';

/**
 * The reader's page themes, drawn into the page on the server (2026-11-18). The reader used to lay them over the whole column as a
 * chain of CSS filters, which a browser re-runs over the screen on every frame that moves: in Firefox, Paper, Sepia and Gray made
 * scrolling choppy. A toned page is made once, cached like any page, and scrolls as a plain image.
 *
 * The same functions, in the same order, as the CSS the reader used (web lib/readerPrefs.ts THEME_FILTER), each clamped as CSS clamps
 * between filter functions, on sRGB values as browsers apply them -- so a toned page looks as the filtered one did.
 */
export type PageTone = 'paper' | 'sepia' | 'gray';
export const PAGE_TONES: readonly PageTone[] = ['paper', 'sepia', 'gray'];
export const toneOf = (v: unknown): PageTone | null => (PAGE_TONES as readonly unknown[]).includes(v) ? (v as PageTone) : null;

type Step = { m: number[]; b?: number };
const brightness = (k: number): Step => ({ m: [k, 0, 0, 0, k, 0, 0, 0, k] });
const contrast = (k: number): Step => ({ m: [k, 0, 0, 0, k, 0, 0, 0, k], b: 0.5 * (1 - k) });
const sepia = (a: number): Step => {
  const r = 1 - a;
  return { m: [0.393 + 0.607 * r, 0.769 - 0.769 * r, 0.189 - 0.189 * r, 0.349 - 0.349 * r, 0.686 + 0.314 * r, 0.168 - 0.168 * r, 0.272 - 0.272 * r, 0.534 - 0.534 * r, 0.131 + 0.869 * r] };
};
const saturate = (s: number): Step => ({ m: [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s] });
const grayscale = (a: number): Step => {
  const r = 1 - a;
  return { m: [0.2126 + 0.7874 * r, 0.7152 - 0.7152 * r, 0.0722 - 0.0722 * r, 0.2126 - 0.2126 * r, 0.7152 + 0.2848 * r, 0.0722 - 0.0722 * r, 0.2126 - 0.2126 * r, 0.7152 - 0.7152 * r, 0.0722 + 0.9278 * r] };
};

/** The web's THEME_FILTER, as steps. Keep the two in step (pageTone.test.ts reads the web's strings). */
export const TONE_STEPS: Record<PageTone, Step[]> = {
  paper: [brightness(0.92), sepia(0.25), saturate(1.1), brightness(0.94)],
  sepia: [sepia(0.55), saturate(1.15), brightness(0.94)],
  gray: [grayscale(0.25), brightness(0.88), contrast(0.95)],
};

/** One colour through the steps, 0..1 per channel. Exported for the tests. */
export function toneRgb(tone: PageTone, rgb: [number, number, number]): [number, number, number] {
  let [r, g, b] = rgb;
  for (const { m, b: off = 0 } of TONE_STEPS[tone]) {
    const nr = m[0] * r + m[1] * g + m[2] * b + off;
    const ng = m[3] * r + m[4] * g + m[5] * b + off;
    const nb = m[6] * r + m[7] * g + m[8] * b + off;
    r = Math.min(1, Math.max(0, nr)); g = Math.min(1, Math.max(0, ng)); b = Math.min(1, Math.max(0, nb));
  }
  return [r, g, b];
}

/** The page in the tone, as webp. */
export async function tonePage(bytes: Buffer, tone: PageTone): Promise<{ buffer: Buffer; contentType: string }> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 200_000_000, animated: false })
    .toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const out = Buffer.allocUnsafe(info.width * info.height * 3);
  // Each distinct colour is worked out once: a grey page (most manga) has at most 256 of them.
  const memo = new Map<number, number>();
  for (let i = 0, o = 0; i < data.length; i += ch, o += 3) {
    const r = data[i], g = ch >= 3 ? data[i + 1] : r, b = ch >= 3 ? data[i + 2] : r;
    const key = (r << 16) | (g << 8) | b;
    let v = memo.get(key);
    if (v === undefined) {
      const t = toneRgb(tone, [r / 255, g / 255, b / 255]);
      v = (Math.round(t[0] * 255) << 16) | (Math.round(t[1] * 255) << 8) | Math.round(t[2] * 255);
      memo.set(key, v);
    }
    out[o] = v >> 16; out[o + 1] = (v >> 8) & 255; out[o + 2] = v & 255;
  }
  const buffer = await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ quality: 90, effort: 2 }).toBuffer();
  return { buffer, contentType: 'image/webp' };
}
