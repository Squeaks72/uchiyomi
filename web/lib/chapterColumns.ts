// How wide the chapter list's columns are: as wide as the longest chapter title on the page needs, within limits.
//
// The columns layout used a fixed 250 px minimum, so a computer at 1440 px drew five columns of ~280 px and every
// title longer than "Ch. 12 · The Return" was cut to "Ch. 12 · The Re…" -- the title, the one thing the row is for.
// Now the column is measured from the titles on the page: a series of short names keeps its many columns, one with
// long names gets fewer, wider ones, and nothing grows past CHAPTER_COL_MAX (a title longer than that is still cut,
// but a row never becomes a 900 px line with its buttons far away from its name).

/** The narrowest column: what the layout always used. */
export const CHAPTER_COL_MIN = 250;
/**
 * Up to here a column may still stretch to share the page (a few more pixels each, three columns instead of a blank
 * strip); past it the titles are long, the page may hold only one or two columns, and a stretched one is a 1,000 px row
 * with its buttons a screen away from its name -- so the column stops at what the titles need (+15%).
 */
export const CHAPTER_COL_STRETCH = 360;
/** The widest column a title may ask for. */
export const CHAPTER_COL_MAX = 720;

/**
 * What a row spends on everything that is not its words: the thumbnail, the status dot, the two buttons, the gaps
 * between them and the row's own padding. The compact list on a pointer takes the thumbnail and the dot away
 * (lib/compactChapters.ts); its hover buttons still hold their place.
 */
export function rowChrome(compactOnPointer: boolean): number {
  return compactOnPointer ? 104 : 168;
}

/** The column width that fits `textPx` of title (and `chrome` px of everything else), kept between the limits. */
export function chapterColumnWidth(textPx: number, chrome: number): number {
  if (!Number.isFinite(textPx) || textPx <= 0) return CHAPTER_COL_MIN;
  return Math.round(Math.min(CHAPTER_COL_MAX, Math.max(CHAPTER_COL_MIN, textPx + chrome)));
}
