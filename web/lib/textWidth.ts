// The width of a string in the page's own font, measured on a canvas -- the layout needs it BEFORE it draws the
// text (how wide should a column be?), and a hidden element per title would cost a layout pass for each.
let ctx: CanvasRenderingContext2D | null | undefined;
let family = '';

/** `text` in px at `size` px and `weight`, in the body's font. 0 where there is no canvas (a server render, a test). */
export function textWidth(text: string, size: number, weight = 400): number {
  if (typeof document === 'undefined') return 0;
  if (ctx === undefined) { try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; } }
  if (!ctx) return 0;
  if (!family) family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  ctx.font = `${weight} ${size}px ${family}`;
  return ctx.measureText(text).width;
}

/** The body's font may not have loaded when the first measure ran: forget what was read so the next one looks again. */
export function resetTextWidth(): void { family = ''; }
