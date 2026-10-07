import { blurb } from '@/lib/blurb';

/** The first lines of a series' description under its thumbnail; renders nothing when there is none. */
export function Blurb({ text, className = '' }: { text?: string | null; className?: string }) {
  const b = blurb(text);
  if (!b) return null;
  return <p dir="auto" data-blurb className={`mt-0.5 line-clamp-3 text-[11px] leading-snug text-fog-500 ${className}`}>{b}</p>;
}
