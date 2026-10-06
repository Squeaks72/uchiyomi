'use client';
import { motion } from 'framer-motion';
import { useEffect, useId, useRef } from 'react';
import { ReaderPrefs } from '@/lib/readerPrefs';
import { IcX } from './icons';
import { Switch } from './Switch';
import { t as tr } from '@/lib/i18n';
import { useLayer } from '@/lib/layers';
import { LinkRow } from './settings';

/** One setting. A group of buttons is named by its label; a slider names itself (`slider`). */
function Row({ label, slider, children }: { label: string; slider?: boolean; children: React.ReactNode }) {
  const id = useId();
  return (
    <div className="py-3">
      <div className="mb-2 flex items-center justify-between">
        <span id={id} className="text-sm font-medium text-fog-200">{label}</span>
      </div>
      {slider ? children : <div role="group" aria-labelledby={id}>{children}</div>}
    </div>
  );
}

/** A choice between buttons: states which one is on, and shares the one look. */
function Choice({ on, onClick, className = 'py-3', children }: { on: boolean; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`rounded-2xl border text-sm ${className} ${on ? 'border-accent bg-accent-soft text-accent' : 'border-ink-700 text-fog-300'}`}>
      {children}
    </button>
  );
}

/** A group's heading with the one line that says what the group is: which settings belong to this series and
 *  which are everyone's (the audit found people could not tell). */
function Group({ title, help }: { title: string; help: string }) {
  return (
    <div className="mt-3 border-t border-ink-700 pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fog-300">{title}</h3>
      <p className="mt-1 text-xs leading-snug text-fog-500">{help}</p>
    </div>
  );
}

export function ReaderSettings({
  prefs,
  set,
  onClose,
  sourceName,
  sourceDefault,
  onSourceDefault,
  seriesPinned,
  onResetSeries,
}: {
  prefs: ReaderPrefs;
  set: (p: Partial<ReaderPrefs>) => void;
  onClose: () => void;
  /** The source this chapter came from, named for the button. Absent for a copy with no source on record. */
  sourceName?: string;
  /** Whether that source already has a default saved, which decides what the button offers. */
  sourceDefault?: boolean;
  /** Save the current mode/theme/spread as that source's default, or clear it when `false` is passed. */
  onSourceDefault?: (save: boolean) => void;
  /** Whether this series holds a look of its own, which decides whether the reset button is offered. */
  seriesPinned?: boolean;
  /** Forget this series' own look so it follows its source and the profile again. */
  onResetSeries?: () => void;
}) {
  // A sheet on the notices' layer stack (lib/layers.ts). It runs to the bottom edge, so it does not leave the
  // nav band free -- the reader has no nav there anyway -- and its panel is measured, so a notice rises above
  // it rather than covering its last rows.
  const panelRef = useRef<HTMLDivElement>(null);
  useLayer('dialog', true, { ref: panelRef });
  // Focus goes in when the sheet opens and back to what opened it when it closes; Escape closes. Tab stays
  // inside, because the page behind is covered and a focus ring on it would be unseen.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, []);
  return (
    <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Capped and scrollable: with the reading-direction and this-source rows, the sheet outgrew a short
          phone and pushed its first rows off the top. */}
      <motion.div
        ref={panelRef}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 360, damping: 36 }}
        role="dialog" aria-modal="true" aria-label={tr('Reader')} tabIndex={-1}
        data-lenis-prevent
        className="focus-visible:outline-none absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-4xl border-t border-ink-700 bg-ink-900/95 px-5 pt-4 backdrop-blur-xl pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))]"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink-600" />
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{tr('Reader')}</h2>
          <button onClick={onClose} aria-label={tr('Close')} className="relative grid h-8 w-8 place-items-center text-fog-500 hover:text-fog-200"><IcX width={20} height={20} aria-hidden /></button>
        </div>

        <Group title={tr('Saved for this series')} help={tr('Mode, page tone, pages per view and direction apply to this series only.')} />

        <Row label={tr('Reading mode')}>
          <div className="grid grid-cols-2 gap-2">
            {(['vertical', 'paged'] as const).map((m) => (
              <Choice key={m} on={prefs.mode === m} onClick={() => set({ mode: m })}>
                {m === 'vertical' ? tr('Webtoon (scroll)') : tr('Paged (swipe)')}
              </Choice>
            ))}
          </div>
        </Row>

        <Row label={tr('Page tone')}>
          <div className="grid grid-cols-3 gap-2">
            {(['amoled', 'sepia', 'gray'] as const).map((t) => (
              <Choice key={t} on={prefs.theme === t} onClick={() => set({ theme: t })}>
                {t === 'amoled' ? tr('AMOLED') : t === 'sepia' ? tr('Sepia') : tr('Gray')}
              </Choice>
            ))}
          </div>
        </Row>

        {prefs.mode === 'paged' && (
          <Row label={tr('Pages per view')}>
            <div className="grid grid-cols-2 gap-2">
              <Choice on={!prefs.spread} onClick={() => set({ spread: false })}>{tr('Single')}</Choice>
              <Choice on={!!prefs.spread} onClick={() => set({ spread: true })}>{tr('Double spread')}</Choice>
            </div>
          </Row>
        )}

        {prefs.mode === 'paged' && (
          <Row label={tr('Reading direction')}>
            <div className="grid grid-cols-3 gap-2">
              {([['series', tr('Follow the series')], ['ltr', tr('Left to right')], ['rtl', tr('Right to left')]] as const).map(([v, label]) => (
                <Choice key={v} on={prefs.pagedDirection === v} onClick={() => set({ pagedDirection: v })} className="px-1 py-3">{label}</Choice>
              ))}
            </div>
          </Row>
        )}

        {onResetSeries && seriesPinned && (
          <div className="pb-1 pt-1">
            <button onClick={onResetSeries}
              className="w-full rounded-2xl border border-ink-700 py-2.5 text-xs text-fog-400">
              {tr('Reset this series to my defaults')}
            </button>
          </div>
        )}

        {/*
          One source is a good proxy for one FORMAT: a webtoon source wants continuous vertical scroll, a
          manga source wants paged right-to-left. Pinning the current look to the source fixes every title
          from it at once, instead of the global default being wrong for half the library or each series
          having to be corrected by hand. A series you have already adjusted still wins over this.
        */}
        {sourceName && onSourceDefault && (
          <Row label={tr('This source')}>
            <div className="grid gap-2">
              <button onClick={() => onSourceDefault(true)}
                className="rounded-2xl border border-ink-700 py-3 text-sm text-fog-300">
                {tr('Use these settings for every series from {source}', { source: sourceName })}
              </button>
              {sourceDefault && (
                <button onClick={() => onSourceDefault(false)}
                  className="rounded-2xl border border-ink-700 py-2.5 text-xs text-fog-400">
                  {tr('Forget the default for {source}', { source: sourceName })}
                </button>
              )}
            </div>
          </Row>
        )}
        <Group title={tr('Reader defaults')} help={tr('Used for every series, unless a source or a series has its own.')} />

        <Row slider label={`${tr('Brightness')} · ${Math.round(prefs.brightness * 100)}%`}>
          <input type="range" min={0.25} max={1} step={0.05} value={prefs.brightness}
            aria-label={tr('Brightness')} aria-valuetext={`${Math.round(prefs.brightness * 100)}%`}
            onChange={(e) => set({ brightness: Number(e.target.value) })}
            className="w-full accent-[rgb(var(--accent))]" />
        </Row>

        {/* #170: the cover's colour across the top and bottom of the screen. A switch on one line, the only boolean here:
            on by default, and the same setting as Profile → Settings → Reading -- every title, not this one. */}
        <div className="flex items-center justify-between gap-3 py-3">
          <span className="text-sm font-medium text-fog-200">{tr('Cover colour at the edges')}</span>
          <Switch on={prefs.coverEdges} onChange={(coverEdges) => set({ coverEdges })} label={tr('Cover colour at the edges')} />
        </div>

        {/* Set in both modes. ⚠️ It cannot LOOK the same in both: a page-by-page view has no thin slide --
            every slide is exactly one viewport wide -- so under Collapse a repeated page is shown there like
            any other, where it costs one swipe rather than a scroll. (Not removed: that would give the two modes
            different page orders, and switching mode mid-chapter would land on another page. Hide removes.) */}
        <Row label={tr('Repeated pages')}>
          <div className="grid grid-cols-3 gap-2">
            <Choice on={prefs.junkPages === 'show'} onClick={() => set({ junkPages: 'show' })}>{tr('Show all')}</Choice>
            <Choice on={prefs.junkPages === 'collapse'} onClick={() => set({ junkPages: 'collapse' })}>{tr('Collapse')}</Choice>
            <Choice on={prefs.junkPages === 'hide'} onClick={() => set({ junkPages: 'hide' })}>{tr('Hide')}</Choice>
          </div>
          <p className="mt-2 text-xs leading-snug text-fog-500">
            {tr('Credits and ads repeat in every chapter. Collapse shrinks them to a thin strip you can tap to open. Hide removes them.')}
          </p>
        </Row>

        {prefs.mode === 'vertical' && (
          <>
            <Row slider label={`${tr('Page gap')} · ${prefs.gap}px`}>
              <input type="range" min={0} max={40} step={2} value={prefs.gap}
                aria-label={tr('Page gap')} aria-valuetext={`${prefs.gap}px`}
                onChange={(e) => set({ gap: Number(e.target.value) })}
                className="w-full accent-[rgb(var(--accent))]" />
            </Row>
            <Row slider label={`${tr('Auto-scroll')} · ${prefs.autoScroll === 0 ? tr('off') : prefs.autoScroll.toFixed(1)}`}>
              <input type="range" min={0} max={6} step={0.5} value={prefs.autoScroll}
                aria-label={tr('Auto-scroll')} aria-valuetext={prefs.autoScroll === 0 ? tr('off') : prefs.autoScroll.toFixed(1)}
                onChange={(e) => set({ autoScroll: Number(e.target.value) })}
                className="w-full accent-[rgb(var(--accent))]" />
            </Row>
          </>
        )}

        <Row label={tr('Page size')}>
          <div className="grid grid-cols-2 gap-2">
            <Choice on={prefs.fitWidth} onClick={() => set({ fitWidth: true })}>{tr('Fit width')}</Choice>
            <Choice on={!prefs.fitWidth} onClick={() => set({ fitWidth: false })}>{tr('Original')}</Choice>
          </div>
        </Row>

        <LinkRow href="/profile/?tab=Settings&section=reading" label={tr('Reader defaults → Settings')} help={tr('Set them for every device under Profile → Settings → Reading.')} />
      </motion.div>
    </motion.div>
  );
}
