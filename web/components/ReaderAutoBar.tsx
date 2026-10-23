'use client';
import { useEffect, useState } from 'react';
import { t as tr } from '@/lib/i18n';
import { IcPause, IcPlay, IcX } from '@/components/icons';

/**
 * The reader's auto-scroll as a video player's controls: play and pause, back and forward, slower and faster, stop.
 *
 * Shown while auto-scroll is on (a webtoon column scrolling by itself, or paged pages turning by themselves). Like a
 * player's bar it fades after a few seconds of nothing happening while it plays, wakes on any pointer, touch or key, and
 * stays up while paused. Faded, it takes no taps: they go to the page under it.
 *
 * `paged`: back and forward are the previous and next page; otherwise ten seconds of scrolling either way.
 * `raised`: the reader's own bars are up, so this sits above the footer instead of at the screen's edge.
 */
const SKIP = 'grid h-11 min-w-11 place-items-center rounded-xl px-2 text-white transition hover:bg-white/15 active:bg-white/25 disabled:opacity-40';

function Skip({ forward }: { forward?: boolean }) {
  // Counter-clockwise for back, clockwise for forward: two drawn shapes, not one flipped, so the arrowhead sits on the end of its arc.
  return (
    <span className="relative grid place-items-center" aria-hidden>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {forward
          ? <><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></>
          : <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>}
      </svg>
      <span className="absolute text-[8px] font-semibold leading-none">10</span>
    </span>
  );
}

export function ReaderAutoBar({ paged, playing, speed, raised, onToggle, onBack, onForward, onSlower, onFaster, onStop }: {
  paged: boolean; playing: boolean; speed: string; raised: boolean;
  onToggle: () => void; onBack: () => void; onForward: () => void; onSlower: () => void; onFaster: () => void; onStop: () => void;
}) {
  const [awake, setAwake] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      setAwake(true);
      if (timer) clearTimeout(timer);
      if (playing) timer = setTimeout(() => setAwake(false), 3500);
    };
    wake();
    const evs = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const;
    for (const ev of evs) window.addEventListener(ev, wake, { passive: true });
    return () => { for (const ev of evs) window.removeEventListener(ev, wake); if (timer) clearTimeout(timer); };
  }, [playing]);
  const shown = awake || !playing;
  return (
    <div role="toolbar" aria-label={tr('Auto-scroll controls')} data-auto-bar data-playing={playing ? '1' : '0'}
      className={`absolute inset-x-0 z-40 flex justify-center px-3 transition-opacity duration-300 ${raised ? 'bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]' : 'bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]'} ${shown ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
      <div className="flex items-center gap-0.5 rounded-2xl border border-white/10 bg-black/70 px-1.5 py-1 backdrop-blur-md" dir="ltr">
        <button type="button" onClick={onBack} className={SKIP} aria-label={paged ? tr('Previous page') : tr('Back 10 seconds')} title={paged ? tr('Previous page') : tr('Back 10 seconds')}>
          <Skip />
        </button>
        <button type="button" onClick={onToggle} className={`${SKIP} h-12 min-w-12`} aria-label={playing ? tr('Pause auto-scroll') : tr('Play auto-scroll')}
          title={playing ? tr('Pause auto-scroll') : tr('Play auto-scroll')} data-auto-toggle>
          {playing ? <IcPause width={26} height={26} /> : <IcPlay width={26} height={26} />}
        </button>
        <button type="button" onClick={onForward} className={SKIP} aria-label={paged ? tr('Next page') : tr('Forward 10 seconds')} title={paged ? tr('Next page') : tr('Forward 10 seconds')}>
          <Skip forward />
        </button>
        <span className="mx-1 h-6 w-px bg-white/15" aria-hidden />
        <button type="button" onClick={onSlower} className={`${SKIP} text-lg`} aria-label={tr('Slower')} title={tr('Slower')}>−</button>
        <span className="min-w-12 select-none text-center text-xs tabular-nums text-white/90" data-auto-speed>{speed}</span>
        <button type="button" onClick={onFaster} className={`${SKIP} text-lg`} aria-label={tr('Faster')} title={tr('Faster')}>+</button>
        <span className="mx-1 h-6 w-px bg-white/15" aria-hidden />
        <button type="button" onClick={onStop} className={SKIP} aria-label={tr('Stop auto-scroll')} title={tr('Stop auto-scroll')}>
          <IcX width={18} height={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}
