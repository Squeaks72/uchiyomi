import sharp from 'sharp';

/** WebP cannot encode an image taller than this; a long webtoon strip can be. */
const WEBP_MAX_SIDE = 16383;

export interface FittedPage { buffer: Buffer; contentType: string }

/**
 * A page at `w` pixels wide, for a screen that cannot show more. The original goes out untouched when it is
 * already that narrow, when it is animated, when sharp cannot read it, or when the re-encode would not be
 * smaller -- re-encoding a page that fits only costs it quality. A strip too tall for WebP is sent as JPEG.
 */
export async function fitPageWidth(bytes: Buffer, w: number, original: string): Promise<FittedPage> {
  const keep = { buffer: bytes, contentType: original };
  let meta: sharp.Metadata;
  try { meta = await sharp(bytes).metadata(); } catch { return keep; }
  if (!meta.width || !meta.height || meta.width <= w || (meta.pages ?? 1) > 1) return keep;
  const tooTall = Math.round(meta.height * (w / meta.width)) > WEBP_MAX_SIDE;
  try {
    const base = sharp(bytes).resize({ width: w, withoutEnlargement: true });
    const out: FittedPage = tooTall
      ? { buffer: await base.flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(), contentType: 'image/jpeg' }
      : { buffer: await base.webp({ quality: 80 }).toBuffer(), contentType: 'image/webp' };
    return out.buffer.length < bytes.length ? out : keep;
  } catch {
    return keep;
  }
}
