// Guessing a title's reading mode when nobody has said: from the pages themselves first, then from what kind of comic it is.
// Pure. The reader applies the guess only below every explicit choice (library, source, series) and never stores it.
export type GuessedMode = 'vertical' | 'paged';

export interface GuessPage { width: number | null; height: number | null; junk?: boolean; missing?: boolean }

/** A page this tall for its width (height / width) is a strip; a typical manga or comic page is near 1.4-1.6. */
export const STRIP_RATIO = 2.2;
export const PAGE_RATIO = 1.8;
/** Fewer measured pages than this say nothing: one tall credit page does not make a webtoon. */
export const MIN_PAGES = 3;

/** The median height/width of the measured pages, or null when too few were measured. */
export function medianRatio(pages: readonly GuessPage[]): number | null {
  const r = pages
    .filter((p) => !p.junk && !p.missing && p.width && p.height && p.width > 0 && p.height > 0)
    .map((p) => (p.height as number) / (p.width as number))
    .sort((a, b) => a - b);
  if (r.length < MIN_PAGES) return null;
  const m = r.length >> 1;
  return r.length % 2 ? r[m] : (r[m - 1] + r[m]) / 2;
}

/** Page shape alone: strips read vertically, book-shaped pages page. Between the two, no opinion. */
export function modeFromPages(pages: readonly GuessPage[]): GuessedMode | null {
  const r = medianRatio(pages);
  if (r == null) return null;
  if (r >= STRIP_RATIO) return 'vertical';
  if (r <= PAGE_RATIO) return 'paged';
  return null;
}

/** The kind of comic alone: scrolling origins scroll, the rest page. `rtl` (a series that reads right to left) is manga. */
export function modeFromKind(kind: string | null | undefined, rtl: boolean): GuessedMode | null {
  if (kind === 'webtoon' || kind === 'manhwa' || kind === 'manhua') return 'vertical';
  if (kind === 'manga' || kind === 'comic') return 'paged';
  return rtl ? 'paged' : null;
}

/** The pages win (they are about this very chapter); the kind of comic decides when they cannot. */
export function guessMode(pages: readonly GuessPage[], kind: string | null | undefined, rtl: boolean): GuessedMode | null {
  return modeFromPages(pages) ?? modeFromKind(kind, rtl);
}
