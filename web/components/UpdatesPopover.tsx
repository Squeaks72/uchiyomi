'use client';
// Updates as a bubble (2026-11-18, the owner: "it seems unnecessary to be an entire page"): the new chapters of the series this reader
// follows, Check for new chapters and Mark all read, and what is expected this week -- in a panel that grows out of the bell and
// shrinks back into it on a second press, outside click, Escape or navigation. One panel for the app (UpdatesHost, in AppShell); every
// bell, the More sheet and the command palette open it. /updates/ is home with the panel open, for old links.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, img } from '@/lib/api';
import type { Series } from '@/lib/types';
import { relativeTime } from '@/lib/format';
import { t as tr } from '@/lib/i18n';
import { byExpected, radarText } from '@/lib/radar';
import { Img } from './ui';
import { useToast } from './Toast';
import { CheckForNew } from './CheckForNew';
import { IcBell, IcCheck } from './icons';

interface UpdateItem { series: Series; newCount: number; latestAt?: string | null }

const EVENT = 'yomi:updates';
/** Open, close or toggle the panel, grown from `from` (the bell pressed), else from the top end of the window. */
export function toggleUpdates(from?: HTMLElement | null, open?: boolean) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { from: from ?? null, open } }));
}
export const openUpdates = (from?: HTMLElement | null) => toggleUpdates(from, true);

/** The bell: a press opens the panel out of it, a second press closes it. */
export function UpdatesBell({ count, className }: { count: number; className: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setOpen((e as CustomEvent<{ state?: boolean }>).detail?.state ?? false);
    window.addEventListener(`${EVENT}:state`, on);
    return () => window.removeEventListener(`${EVENT}:state`, on);
  }, []);
  return (
    <button ref={ref} type="button" data-updates-bell onClick={() => toggleUpdates(ref.current)} title={tr('Updates')} aria-label={tr('Updates')}
      aria-haspopup="dialog" aria-expanded={open} className={`${className} ${open ? 'text-accent' : ''}`}>
      <IcBell width={19} height={19} />
      {/* A squared tag: a round one grows into a capsule at "9+". */}
      {count > 0 && <span data-updates-count className="absolute -end-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-[4px] bg-accent px-[3px] text-[10px] pointer-coarse:text-[11px] font-bold leading-none tabular-nums text-black">{count > 9 ? '9+' : count}</span>}
    </button>
  );
}

export function UpdatesHost() {
  const [anchor, setAnchor] = useState<{ top: number; end: number } | null>(null);
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  const setOpen = (v: boolean) => { openRef.current = v; setOpenState(v); };
  const panel = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const path = usePathname();
  const rtl = typeof document !== 'undefined' && document.dir === 'rtl';

  useEffect(() => {
    const on = (e: Event) => {
      const { from, open: want } = (e as CustomEvent<{ from: HTMLElement | null; open?: boolean }>).detail ?? {};
      const next = want ?? !openRef.current;
      if (next) {
        // Opened from a menu: out of whichever bell is on screen (the phone's is on home only), else the window's top end.
        const bell = from ?? [...document.querySelectorAll<HTMLElement>('[data-updates-bell]')].find((b) => b.getBoundingClientRect().width > 0);
        const r = bell?.getBoundingClientRect();
        setAnchor(r && r.width ? { top: r.bottom + 8, end: rtl ? r.left : window.innerWidth - r.right } : { top: 72, end: 12 });
      }
      openRef.current = next;
      setOpen(next);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [rtl]);
  // Every bell shows whether the panel is open.
  useEffect(() => { window.dispatchEvent(new CustomEvent(`${EVENT}:state`, { detail: { state: open } })); }, [open]);
  // Navigating (a series opened from the panel) closes it.
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // A press outside the panel closes it -- but not one on a bell, which toggles it itself.
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (panel.current?.contains(t) || t?.closest?.('[data-updates-bell]')) return;
      setOpen(false);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down, true);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', down, true); };
  }, [open]);

  return (
    <AnimatePresence>
      {open && anchor && (
        <motion.div ref={panel} role="dialog" aria-label={tr('Updates')} data-updates-panel
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
          style={{ top: anchor.top, insetInlineEnd: Math.max(8, anchor.end), transformOrigin: rtl ? 'top left' : 'top right', maxHeight: `calc(100dvh - ${anchor.top + 12}px)` }}
          className="fixed z-[60] flex w-[min(26rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/95 shadow-2xl backdrop-blur-xl">
          <UpdatesPanel />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function UpdatesPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['updates'], queryFn: () => api<{ content: UpdateItem[] }>('/api/updates') });
  const items = data?.content ?? [];
  const markAll = async () => {
    await api('/api/updates/seen', { method: 'POST' });
    toast(tr('All caught up'), 'success');
    void qc.invalidateQueries({ queryKey: ['home'] });
    void refetch();
  };
  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-4 py-3">
        <h2 className="font-display text-lg font-semibold">{tr('Updates')}</h2>
        <div className="ms-auto flex items-center gap-2">
          <CheckForNew />
          {items.length > 0 && <button type="button" onClick={() => void markAll()} className="btn-key"><IcCheck width={14} height={14} />{tr('Mark all read')}</button>}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-lenis-prevent>
        {isLoading ? (
          <div className="space-y-2 p-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-fog-400">
            {tr('You’re all caught up')}<span className="mt-1 block text-xs text-fog-500">{tr('Favorite a series and its new chapters show up here.')}</span>
          </p>
        ) : (
          <ul className="divide-y divide-ink-800/70">
            {items.map(({ series, newCount, latestAt }) => (
              <li key={series.id}>
                <Link href={`/series/?id=${series.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.04]">
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-ink-700">
                    <Img src={img.seriesThumb(series.id)} alt="" className="h-full w-full" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-sm font-medium text-fog-100">{series.metadata?.title || series.name}</p>
                    <p className="mt-0.5 text-xs text-accent">
                      {newCount === 1 ? tr('+1 new chapter') : tr('+{n} new chapters', { n: newCount })}
                      {latestAt && <span className="text-fog-500"> · {relativeTime(latestAt)}</span>}
                    </p>
                  </div>
                  <span className="grid h-6 min-w-6 place-items-center rounded-md bg-accent px-1.5 text-xs font-bold tabular-nums text-black">{newCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <ExpectedThisWeek />
      </div>
    </>
  );
}

/**
 * Expected this week (v0.61.0): the followed series whose next chapter the release radar puts within seven days (GET
 * /api/updates/expected, bff lib/releaseRadar.ts), soonest first -- under the new chapters, and under "all caught up" too. Hidden
 * when nothing is expected.
 */
function ExpectedThisWeek() {
  const { data } = useQuery({ queryKey: ['updates-expected'], queryFn: () => api<{ content: Series[] }>('/api/updates/expected') });
  const list = [...(data?.content ?? [])].sort(byExpected);
  if (!list.length) return null;
  return (
    <section data-expected className="border-t border-ink-800 pb-2 pt-3">
      <h3 className="px-4 text-sm font-semibold text-fog-200">{tr('Expected this week')}</h3>
      <p className="px-4 text-[11px] text-fog-500">{tr('Estimated from when chapters usually arrive, not promised.')}</p>
      <ul className="mt-1">
        {list.map((series) => (
          <li key={series.id}>
            <Link href={`/series/?id=${series.id}`} className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-white/[0.04]">
              <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md border border-ink-700">
                <Img src={img.seriesThumb(series.id)} alt="" className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate text-sm text-fog-100">{series.metadata?.title || series.name}</p>
                <p className="text-[11px] text-fog-400">{radarText(series.yomi?.radar, { autoUpdate: series.autoUpdate !== false })}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
