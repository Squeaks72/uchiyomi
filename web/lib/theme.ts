// Cover-art ambient theming: drives the `--cover` CSS var (an "r g b" triplet) so components
// can paint soft glows with `rgb(var(--cover, 134 105 255) / <alpha>)`. Falls back to accent.

function parse(hex?: string | null): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const h = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** Lift very dark dominant colors so the ambient glow is still visible on true black. */
function lift({ r, g, b }: { r: number; g: number; b: number }) {
  const max = Math.max(r, g, b);
  if (max >= 90) return { r, g, b };
  const k = max === 0 ? 1 : 110 / max;
  return { r: Math.min(255, r * k), g: Math.min(255, g * k), b: Math.min(255, b * k) };
}

export function coverTriplet(hex?: string | null): string | null {
  const rgb = parse(hex);
  if (!rgb) return null;
  const l = lift(rgb);
  return `${Math.round(l.r)} ${Math.round(l.g)} ${Math.round(l.b)}`;
}

export function applyCover(hex?: string | null) {
  if (typeof document === 'undefined') return;
  const t = coverTriplet(hex);
  const el = document.documentElement;
  if (t) el.style.setProperty('--cover', t);
  else el.style.removeProperty('--cover');
}

export function clearCover() {
  if (typeof document !== 'undefined') document.documentElement.style.removeProperty('--cover');
}

const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luma = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** WCAG contrast ratio of two colours given as [r, g, b]. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luma(...a), luma(...b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACE: [number, number, number] = [0x1a, 0x1a, 0x22]; // ink-700, the lightest surface accent text sits on

/**
 * The accent as it is painted. Accent is used as text on dark surfaces (links, active chips, ghost keys), so a
 * dark pick such as a deep blue would be unreadable; mix it toward white until it reaches 4.5:1 on ink-700.
 * The saved choice is untouched. A bright accent comes back unchanged.
 */
export function readableAccent(hex?: string | null): string | null {
  const rgb = parse(hex);
  if (!rgb) return null;
  let c: [number, number, number] = [rgb.r, rgb.g, rgb.b];
  for (let k = 0; k <= 1 && contrastRatio(c, SURFACE) < 4.5; k += 0.04) {
    c = [rgb.r, rgb.g, rgb.b].map((v) => Math.round(v + (255 - v) * k)) as [number, number, number];
  }
  return c.join(' ');
}
