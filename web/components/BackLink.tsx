'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IcChevronLeft, IcChevronRight } from './icons';
import { t as tr } from '@/lib/i18n';

/**
 * Back, with somewhere to go when there is no "back".
 *
 * A bare `router.back()` does nothing useful on a page opened directly (a bookmark, a shared link, a PWA launched
 * on /history/): there is no entry behind it, so the button was dead -- or worse, left the app. With history it
 * goes back (so scroll and filters are kept); without, it goes to `fallback`.
 */
export function goBack(router: { back: () => void; push: (href: string) => void }, fallback: string): void {
  if (typeof window !== 'undefined' && window.history.length > 1) router.back();
  else router.push(fallback);
}

/** The phone's round back button. `className` replaces the look (the admin hero's is darker, say). */
export function BackLink({ fallback, phoneOnly, className }: { fallback: string; phoneOnly?: boolean; className?: string }) {
  const router = useRouter();
  const look = className ?? 'grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink-800/70 text-fog-100';
  return (
    <button type="button" onClick={() => goBack(router, fallback)} aria-label={tr('Back')} data-back-link
      className={`${look}${phoneOnly ? ' lg:hidden' : ''}`}>
      <IcChevronLeft width={22} height={22} className="rtl:rotate-180" />
    </button>
  );
}

/** The desktop breadcrumb: Home › Parent › Current. Hidden on a phone, where the round button above it is the way back. */
export function Breadcrumb({ trail, current }: { trail: ReadonlyArray<{ label: string; href: string }>; current: string }) {
  return (
    <nav aria-label={tr('Breadcrumb')} data-breadcrumb className="hidden items-center gap-1.5 pb-1 pt-6 text-sm text-fog-400 lg:flex">
      {trail.map((c) => (
        <span key={c.href} className="flex items-center gap-1.5">
          <Link href={c.href} className="hover:text-fog-100">{c.label}</Link>
          <IcChevronRight width={14} height={14} aria-hidden className="rtl:-scale-x-100" />
        </span>
      ))}
      <span aria-current="page" className="min-w-0 truncate text-fog-200">{current}</span>
    </nav>
  );
}
