/**
 * The start of a description, for under a thumbnail: markup and entities out, whitespace collapsed, cut at a word
 * near `max` characters with an ellipsis. Sources hand over HTML, markdown and "Summary:" labels in equal measure;
 * the card clamps the lines, this only bounds how much text is put in the page for each of hundreds of cards.
 */
export function blurb(text: string | null | undefined, max = 160): string {
  if (!text) return '';
  const plain = String(text)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[*_`#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:summary|synopsis|description)\s*[:：-]\s*/i, '')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`;
}
