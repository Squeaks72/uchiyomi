'use client';
import { IcStar } from '@/components/icons';
import { t as tr } from '@/lib/i18n';

export function StarRating({ value, onSet }: { value: number | null; onSet: (n: number) => void }) {
  return (
    <div role="group" aria-label={tr('Rate this')} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onSet(n)} aria-label={n === 1 ? tr('1 star') : tr('{n} stars', { n })} aria-pressed={n === value}
          className={`relative before:absolute before:-inset-1 ${n <= (value || 0) ? 'text-accent' : 'text-fog-400'}`}>
          <IcStar width={22} height={22} fill={n <= (value || 0) ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

/** The read-only "★ 4/5" text; `chip` renders it as the small chip the hero uses. */
export function RatingText({ rating, chip }: { rating: number; chip?: boolean }) {
  return <span className={chip ? 'chip text-[11px] text-accent' : 'text-accent'}>★ {rating}/5</span>;
}
