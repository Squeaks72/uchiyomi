'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReaderImg } from '@/components/ReaderPage';
import { t as tr } from '@/lib/i18n';
import { WHOLE_PAGE, frameOf, panelsOfImage, type Box } from '@/lib/readerPanels';
import type { ReaderImageRetry } from '@/lib/readerImageRetry';

/**
 * Panel view (Reader → Panel view): the page being read, one panel at a time, laid over the paged track.
 *
 * The track underneath is untouched and still owns which page is current, the scrubber, progress and the chapter's end:
 * this only draws the current page framed to a panel, and when it runs out of panels asks the reader to turn the page
 * (`onTurn`), which scrolls the track as a tap on its edge would. The page it lands on mounts a new view (keyed by the
 * page), so every page starts at its first panel -- or its last, turning back (`from`).
 *
 * Panels are found once the page has loaded (lib/readerPanels.ts), per page and direction, and kept for the session. No
 * panels -- a splash, full-bleed art, a layout without clear gutters -- and the page is its own single frame: shown whole,
 * and a tap on an edge turns it.
 *
 * Gestures, all here since this sits over the track: a tap on the forward side steps on, the back side steps back, the
 * middle toggles the controls; a swipe steps; a double tap in the middle shows the whole page and again returns to the
 * panels. ⚠️ A double tap is only ever read in the middle -- the edges act at once, or a quick run of taps to catch up
 * on a page would wait out the double-tap window on every one.
 */

/** Panels found, by page and direction, for the session: stepping back to a page does not read its pixels again. */
const found = new Map<string, Box[]>();

const DOUBLE_MS = 280;
const SWIPE_PX = 48;

export function PanelView({ pageKey, src, alt, width, height, rtl, filter, from, reduceMotion, onTurn, onChrome, onRetry }: {
  pageKey: string;
  src: string;
  alt: string;
  /** The page's size as the server knows it, when it does: framing can start before the image has loaded. */
  width: number | null;
  height: number | null;
  /** Panels in a row read right to left. */
  rtl: boolean;
  filter?: string;
  /** Which panel the page opens on: the first, or the last (turning back to it). */
  from: 'first' | 'last';
  reduceMotion?: boolean;
  /** Past the last panel (1) or before the first (-1): turn the page. */
  onTurn: (dir: 1 | -1) => void;
  onChrome: () => void;
  onRetry?: ReaderImageRetry;
}) {
  const cacheKey = `${pageKey}|${rtl ? 'r' : 'l'}`;
  const [panels, setPanels] = useState<Box[] | null>(() => found.get(cacheKey) ?? null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(width && height ? { w: width, h: height } : null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [idx, setIdx] = useState<number | null>(null);
  const [whole, setWhole] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Where the page opened is decided once: the parent's `from` is spent as soon as the page is on screen.
  const [start] = useState(from);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const m = () => setView((v) => (v.w === el.clientWidth && v.h === el.clientHeight ? v : { w: el.clientWidth, h: el.clientHeight }));
    m();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(m) : null;
    ro?.observe(el);
    window.addEventListener('resize', m);
    return () => { ro?.disconnect(); window.removeEventListener('resize', m); };
  }, []);

  const loaded = useCallback((img: HTMLImageElement) => {
    if (img.naturalWidth && img.naturalHeight) setSize((s) => (s && s.w === img.naturalWidth && s.h === img.naturalHeight ? s : { w: img.naturalWidth, h: img.naturalHeight }));
    if (found.has(cacheKey)) { setPanels(found.get(cacheKey)!); return; }
    const p = panelsOfImage(img, rtl);
    if (found.size > 400) found.delete(found.keys().next().value as string);
    found.set(cacheKey, p);
    setPanels(p);
  }, [cacheKey]);

  const list = panels && panels.length > 1 ? panels : null;
  // Where the page opens, once its panels are known.
  const at = idx ?? (list ? (start === 'last' ? list.length - 1 : 0) : 0);
  const framed = !whole && list ? list[Math.min(at, list.length - 1)] : WHOLE_PAGE;
  const f = size && view.w ? frameOf(framed, size, view) : null;

  const step = (d: 1 | -1) => {
    if (whole || !list) { onTurn(d); return; }
    const n = at + d;
    if (n < 0 || n >= list.length) { onTurn(d); return; }
    setIdx(n);
  };

  // ---- gestures ----
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTap = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) { down.current = null; return; }
    down.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onUp = (e: React.PointerEvent) => {
    const s = down.current; down.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    // A swipe: toward the left reads on, unless the row reads right to left. Mostly horizontal, or it was a scroll.
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      step((dx < 0) !== rtl ? 1 : -1);
      return;
    }
    if (Math.hypot(dx, dy) > 12 || Date.now() - s.t > 600) return; // a drag, or a press held for something else
    const rect = box.current?.getBoundingClientRect();
    const rel = rect && rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
    const side = rel < 0.3 ? 'left' : rel > 0.7 ? 'right' : 'middle';
    if (side !== 'middle') {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      lastTap.current = 0;
      step((side === 'right') !== rtl ? 1 : -1);
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_MS) {
      lastTap.current = 0;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (list) setWhole((w) => !w);
      return;
    }
    lastTap.current = now;
    timer.current = setTimeout(() => { timer.current = null; onChrome(); }, DOUBLE_MS);
  };

  return (
    <div ref={box} data-panel-view data-panels={list ? list.length : 0} data-whole={whole || !list ? '' : undefined}
      onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { down.current = null; }}
      // A tap here is this view's own: the long-press menu and the browser's drag of an image are not wanted over it.
      onContextMenu={(e) => e.preventDefault()}
      dir="ltr" className="absolute inset-0 z-10 touch-none select-none overflow-hidden bg-ink-950">
      {/* The page, drawn at the size that puts the framed box on the screen's centre. Hidden until it is measured, so it
          is never seen at the wrong place on its way there. */}
      <div className="absolute left-0 top-0 origin-top-left"
        style={f ? {
          width: f.width, height: f.height, transform: `translate(${f.x}px, ${f.y}px)`,
          // Only the framed box shows: its neighbours' edges, and the page's own, would peek in round it otherwise.
          clipPath: `inset(${framed.y * 100}% ${(1 - framed.x - framed.w) * 100}% ${(1 - framed.y - framed.h) * 100}% ${framed.x * 100}%)`,
          transition: reduceMotion ? undefined : 'transform 220ms ease-out, width 220ms ease-out, height 220ms ease-out, clip-path 220ms ease-out',
        } : { width: '100%', height: '100%', opacity: 0 }}>
        <ReaderImg onRetry={onRetry} src={src} alt={alt} className="pointer-events-none block h-full w-full max-w-none" filter={filter} onLoaded={loaded} />
      </div>
      {list && !whole && (
        <div aria-live="polite" data-panel-count
          className="pointer-events-none absolute inset-x-0 bottom-[max(0.6rem,env(safe-area-inset-bottom))] flex justify-center">
          <span className="rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-fog-200 backdrop-blur">
            {tr('Panel {n} of {total}', { n: Math.min(at, list.length - 1) + 1, total: list.length })}
          </span>
        </div>
      )}
    </div>
  );
}
