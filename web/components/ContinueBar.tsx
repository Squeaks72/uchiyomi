'use client';
// The series page's reading button, how far the reader is, and -- on a phone -- the bar that keeps both at hand once
// the button has scrolled away (v0.60.0). What the button says is lib/continueLabel.ts's; this draws it.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useReduceEffects } from '@/lib/effects';
import { useLayer } from '@/lib/layers';
import { ProgressBar } from './ui';
import { IcBell, IcCheck, IcPlay } from './icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import { SeriesKey } from './SeriesKeys';

/**
 * The one reading button: the accent key, lit by the series' cover colour (`.cta-glow`, app/globals.css; Reduce
 * effects puts the plain accent shadow back). `compact` is the phone bar's: shorter, the same words.
 */
export function ContinueButton({ label, onOpen, disabled, compact }: { label: string; onOpen: () => void; disabled: boolean; compact?: boolean }) {
  return (
    <button type="button" onClick={onOpen} disabled={disabled} data-continue
      className={`btn-accent min-w-0 disabled:opacity-50 ${disabled ? '' : 'cta-glow'} ${compact ? 'h-11 flex-1 px-4 py-0 text-sm' : 'w-full'}`}>
      <IcPlay width={compact ? 16 : 18} height={compact ? 16 : 18} aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/** "10 of 50 read" beside the bar: how far through the series the reader is. */
export function ReadProgress({ read, total, text }: { read: number; total: number; text: string }) {
  return (
    <div data-read-progress className="flex items-center gap-2.5">
      <div aria-hidden className="min-w-0 flex-1"><ProgressBar value={total > 0 ? Math.min(1, read / total) : 0} /></div>
      <span className="shrink-0 text-[11px] tabular-nums text-fog-500">{text}</span>
    </div>
  );
}

/**
 * Whether `ref`'s element is out of view: above the screen, or under the phone's top bar or below the band the bottom
 * nav and this bar take. `margin` is that band, as an IntersectionObserver rootMargin. False until the observer has
 * answered, and where there is no IntersectionObserver.
 */
export function useOutOfView(ref: RefObject<HTMLElement | null>, margin: string): boolean {
  const [out, setOut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOut(!e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return out;
}

/**
 * The phone's bar (below lg only): once the reading button is out of view, a compact copy of it, the heart and More,
 * above the bottom nav -- where the select bar sits, which is why the page hides this one in Select mode. On the
 * notices' layer stack as a measured toolbar (lib/layers.ts), so a notice rises above it rather than covering it, as it
 * does for the select bar.
 *
 * ⚠️ `bottom-[calc(5.75rem+env(safe-area-inset-bottom))]`, never `bottom-0`: this renders inside AppShell's <main>, its
 * own stacking context under the root-level nav, so at the bottom edge the nav would paint over it whatever its
 * z-index (the select bar's lesson, app/series/page.tsx). From lg up there is no nav, no bar, and the left column holds
 * the button in view.
 *
 * It slides up as it appears; under Reduce effects or the system's reduced motion it simply appears.
 */
export function ContinueBar({ shown, children }: { shown: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer('toolbar', shown, { ref });
  // Both hooks on every render and in this order: `a() || b()` would skip the second whenever the first is true.
  const plain = useReduceEffects();
  const still = useReducedMotion();
  const reduced = plain || !!still;
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div key="continue-bar" ref={ref} data-continue-bar
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: 16 }}
          transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none fixed start-0 end-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 px-4 pb-2 lg:hidden">
          <div className="glass pointer-events-auto mx-auto flex max-w-2xl items-center gap-2 rounded-2xl p-2 shadow-lift">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** This account's subscription to a series (bff series_subscriptions): told about every new chapter, by push and the digest. */
export function useSubscription(seriesId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['subscription', seriesId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<{ subscribed: boolean; devices: number }>(`/api/series/${encodeURIComponent(seriesId)}/subscription`), staleTime: 30_000, enabled: !!seriesId });
  const [busy, setBusy] = useState(false);
  const set = async (on: boolean) => {
    setBusy(true);
    try {
      await api(`/api/series/${encodeURIComponent(seriesId)}/subscription`, { method: on ? 'PUT' : 'DELETE' });
      qc.setQueryData(key, { subscribed: on, devices: data?.devices ?? 0 });
      toast(!on ? tr('Unsubscribed')
        : data && data.devices === 0 ? tr('Subscribed. Turn on notifications in your profile to be told about new chapters.')
        : tr('Subscribed: you’ll hear about every new chapter'), on && data?.devices === 0 ? 'info' : 'success');
    } catch { toast(tr('Could not save'), 'error'); } finally { setBusy(false); }
  };
  return { subscribed: !!data?.subscribed, ready: !!data, busy, set };
}

/**
 * Subscribe (2026-11-18), YouTube's way: told about every new chapter of the series, by the profile's notifications. Three shapes:
 *  - `key`: the series' key row, beside Favourite -- a bell, filled once subscribed;
 *  - the big button where the reading button was, once the reader is caught up on an ongoing series: "Subscribe", or "Subscribed ·
 *    waiting for Ch. N";
 *  - `inline`: the small key on the "not out yet" row.
 * Unsubscribing from the big button asks first; the bell key and the small key toggle at once (they say what they are).
 */
export function SubscribeButton({ seriesId, waitingFor, compact, inline, keyShape }: {
  seriesId: string;
  /** The chapter not out yet, for "waiting for Ch. N". */
  waitingFor?: number;
  compact?: boolean;
  inline?: boolean;
  keyShape?: boolean;
}) {
  const sub = useSubscription(seriesId);
  const [asking, setAsking] = useState(false);
  const on = sub.subscribed;
  if (keyShape) {
    return (
      <SeriesKey icon={<IcBell width={20} height={20} fill={on ? 'currentColor' : 'none'} aria-hidden />} label={on ? tr('Subscribed') : tr('Subscribe')}
        onClick={() => void sub.set(!on)} compact={compact}
        className={on ? 'border-accent/50 bg-accent/10 text-accent' : ''} attrs={{ 'aria-pressed': on, 'data-subscribe': on ? 'on' : 'off', disabled: sub.busy || !sub.ready }} />
    );
  }
  if (inline) {
    return (
      <button type="button" onClick={() => void sub.set(!on)} disabled={sub.busy || !sub.ready} aria-pressed={on} data-subscribe-inline={on ? 'on' : 'off'}
        className={`btn-key shrink-0 whitespace-nowrap ${on ? 'btn-key-accent' : ''}`}>
        {on ? <IcCheck width={14} height={14} aria-hidden /> : <IcBell width={14} height={14} aria-hidden />}
        {on ? tr('Subscribed') : tr('Subscribe')}
      </button>
    );
  }
  const size = compact ? 16 : 18;
  return (
    <>
      <button type="button" onClick={() => (on ? setAsking(true) : void sub.set(true))} disabled={sub.busy || !sub.ready} aria-pressed={on} data-subscribe-big={on ? 'on' : 'off'}
        className={`${on ? 'btn-ghost border border-accent/60 text-accent' : 'btn-accent cta-glow'} min-w-0 disabled:opacity-60 ${compact ? 'h-11 flex-1 px-4 py-0 text-sm' : 'w-full'}`}>
        {on ? <IcCheck width={size} height={size} aria-hidden className="shrink-0" /> : <IcBell width={size} height={size} aria-hidden className="shrink-0" />}
        <span className="min-w-0 truncate">
          {on ? (waitingFor != null ? tr('Subscribed · waiting for Ch. {chapter}', { chapter: waitingFor }) : tr('Subscribed'))
            : tr('Subscribe for new chapters')}
        </span>
      </button>
      {asking && (
        <ConfirmDialog title={tr('Unsubscribe?')} confirmLabel={tr('Unsubscribe')} busy={sub.busy}
          body={<p>{tr('You won’t be notified about new chapters of this series any more.')}</p>}
          onConfirm={async () => { await sub.set(false); setAsking(false); }} onClose={() => setAsking(false)} />
      )}
    </>
  );
}
