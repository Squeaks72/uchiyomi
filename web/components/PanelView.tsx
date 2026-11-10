'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReaderImg } from '@/components/ReaderPage';
import { t as tr } from '@/lib/i18n';
import { WHOLE_PAGE, cameraOf, framingPanels, panelsOfImage, type Box } from '@/lib/readerPanels';
import type { ReaderImageRetry } from '@/lib/readerImageRetry';

/**
 * Panel view (Reader → Panel view): the pages laid side by side in one strip, and a camera over it that is framed on one
 * panel at a time.
 *
 * The strip is the chapter as an open book: page `i` sits at a fixed place in the world (reading order left to right, or
 * right to left for manga), each page fitted to the screen's width. A step to the next panel, or over the page's edge to
 * the next page, only moves the camera -- one uniform `translate() scale()` that is the ONLY thing animated -- so the pages
 * never change shape on the way and a page turn is the same continuous pan as a step across a page.
 * ⚠️ Never animate a page's width, height or clip instead: two things changing at once is the page pinched and then
 * smushed flat that this replaced.
 *
 * The track underneath is untouched and still owns which page is current, the scrubber, progress and the chapter's end:
 * past the last frame this asks the reader to turn the page (`onTurn`), which scrolls the track as a tap on its edge
 * would, and `current` follows. The camera then glides to the next page's first frame (or the previous page's last, going
 * back, `from`). Only the current page and its two neighbours are drawn.
 *
 * A page's frames are its panels (lib/readerPanels.ts, found once it has loaded, kept for the session) -- preceded by the
 * whole page when something on it is bigger than a panel: a double-page spread, a figure across the gutters, one panel that
 * is most of the page (`analyzePage`'s `overview`). No panels -- a splash, full-bleed art, no clear gutters -- and the page
 * is its own single frame, and a tap on an edge turns it.
 *
 * Gestures, all here since this sits over the track: a tap on the forward side steps on, the back side steps back, the
 * middle toggles the controls; a swipe steps; a double tap in the middle shows the whole page and again returns to the
 * panels. ⚠️ A double tap is only ever read in the middle -- the edges act at once, or a quick run of taps to catch up
 * on a page would wait out the double-tap window on every one.
 */

interface Found { panels: Box[]; overview: boolean }
/** What was found, by page and direction, for the session: stepping back to a page does not read its pixels again. */
const found = new Map<string, Found>();

const DOUBLE_MS = 280;
const SWIPE_PX = 48;
/** The gap between two pages of the strip, as a share of the screen's width. */
const GAP = 0.06;

export interface PanelPage { i: number; key: string; src: string; number: number; width: number | null; height: number | null }

export function PanelView({ pages, current, rtl, filter, from, reduceMotion, onTurn, onChrome, onRetry }: {
  /** The current page and the ones either side that exist, by index in the reading flow. */
  pages: PanelPage[];
  current: number;
  /** Pages and panels in a row read right to left. */
  rtl: boolean;
  filter?: string;
  /** Which frame a page opens on when it becomes current: the first, or the last (turning back to it). */
  from: 'first' | 'last';
  reduceMotion?: boolean;
  /** Past the last frame (1) or before the first (-1): turn the page. */
  onTurn: (dir: 1 | -1) => void;
  onChrome: () => void;
  onRetry?: ReaderImageRetry;
}) {
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [results, setResults] = useState<Record<string, Found>>({});
  const [view, setView] = useState({ w: 0, h: 0 });
  const [pick, setPick] = useState<{ key: string; i: number } | null>(null);
  const [whole, setWhole] = useState(false);
  const box = useRef<HTMLDivElement>(null);

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

  // The whole-page look is for the page it was asked on.
  useEffect(() => { setWhole(false); }, [current]);

  const dirKey = rtl ? 'r' : 'l';
  const loaded = useCallback((key: string, img: HTMLImageElement) => {
    if (img.naturalWidth && img.naturalHeight) {
      setSizes((s) => (s[key]?.w === img.naturalWidth && s[key]?.h === img.naturalHeight ? s : { ...s, [key]: { w: img.naturalWidth, h: img.naturalHeight } }));
    }
    const ck = `${key}|${dirKey}`;
    let f = found.get(ck);
    if (!f) {
      f = panelsOfImage(img, rtl);
      if (found.size > 400) found.delete(found.keys().next().value as string);
      found.set(ck, f);
    }
    const got = f;
    setResults((m) => (m[ck] === got ? m : { ...m, [ck]: got }));
  }, [dirKey, rtl]);

  const cur = pages.find((p) => p.i === current);
  const sizeOf = (p: PanelPage) => sizes[p.key] ?? (p.width && p.height ? { w: p.width, h: p.height } : null);
  // A page whose shape is not known yet is drawn as a typical one, and laid out again once it loads.
  const worldOf = (p: PanelPage) => {
    const sz = sizeOf(p);
    return { x: (rtl ? -1 : 1) * p.i * view.w * (1 + GAP), y: 0, w: view.w, h: sz ? view.w * (sz.h / sz.w) : view.w * 1.45 };
  };

  // The frames of the current page: its panels, the whole page first when it asks for that. The page being left is
  // forgotten: a new one opens on its first frame, or its last when it was reached by turning back -- latched when it became
  // current, since `from` is spent by then.
  const latch = useRef<{ key: string; start: 'first' | 'last' } | null>(null);
  if (cur && latch.current?.key !== cur.key) latch.current = { key: cur.key, start: from };
  const res = cur ? results[`${cur.key}|${dirKey}`] ?? found.get(`${cur.key}|${dirKey}`) ?? null : null;
  // Only the panels the camera zooms in on: a strip the full width of the screen would just slide up and down a page that is
  // in view already. Any left out, and the page opens whole first so it is still seen before it is gone into.
  const framing = cur && res && res.panels.length > 1 && view.w ? framingPanels(res.panels, worldOf(cur), view) : null;
  const panels = framing && framing.kept.length ? framing.kept : null;
  const overview = !!panels && (res!.overview || framing!.skipped > 0);
  const frames: Box[] = panels ? (overview ? [WHOLE_PAGE, ...panels] : panels) : [WHOLE_PAGE];
  const first = overview ? 1 : 0; // the first panel's frame
  const at = cur && pick?.key === cur.key ? Math.min(pick.i, frames.length - 1) : latch.current?.start === 'last' ? frames.length - 1 : 0;
  const framed = whole ? WHOLE_PAGE : frames[at];
  const cam = cur && view.w ? cameraOf(framed, worldOf(cur), view) : null;

  // A jump of more than a page (the scrubber, the page grid) is a cut, not a pan across everything between.
  const lastIdx = useRef(current);
  const jumped = Math.abs(current - lastIdx.current) > 1;
  useEffect(() => { lastIdx.current = current; }, [current]);

  const step = (d: 1 | -1) => {
    if (!cur) return;
    if (whole) { setWhole(false); return; }
    const n = at + d;
    if (n < 0 || n >= frames.length) { onTurn(d); return; }
    setPick({ key: cur.key, i: n });
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
      if (panels) setWhole((w) => !w);
      return;
    }
    lastTap.current = now;
    timer.current = setTimeout(() => { timer.current = null; onChrome(); }, DOUBLE_MS);
  };

  const onWhole = whole || !panels || at < first;
  return (
    <div ref={box} data-panel-view data-panels={panels ? panels.length : 0} data-overview={overview ? '' : undefined}
      data-frame={at} data-whole={onWhole ? '' : undefined}
      onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { down.current = null; }}
      // A tap here is this view's own: the long-press menu and the browser's drag of an image are not wanted over it.
      onContextMenu={(e) => e.preventDefault()}
      dir="ltr" className="absolute inset-0 z-10 touch-none select-none overflow-hidden bg-ink-950">
      {/* The strip: every page at its place in the world, moved as one by the camera. Hidden until the screen is measured,
          so it is never seen anywhere but where it will rest. */}
      <div className="absolute left-0 top-0 origin-top-left will-change-transform"
        style={cam ? {
          transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`,
          transition: reduceMotion || jumped ? 'none' : 'transform 360ms cubic-bezier(0.25, 0.8, 0.25, 1)',
        } : { opacity: 0 }}>
        {view.w > 0 && pages.map((p) => {
          const w = worldOf(p);
          return (
            <div key={p.key} data-panel-page={p.number} className="absolute bg-ink-900" style={{ left: w.x, top: w.y, width: w.w, height: w.h }}>
              <StripImg page={p} filter={filter} onLoaded={loaded} onRetry={onRetry} />
            </div>
          );
        })}
      </div>
      {cur && panels && !whole && at >= first && (
        <div aria-live="polite" data-panel-count
          className="pointer-events-none absolute inset-x-0 bottom-[max(0.6rem,env(safe-area-inset-bottom))] flex justify-center">
          <span className="rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-fog-200 backdrop-blur">
            {tr('Panel {n} of {total}', { n: at - first + 1, total: panels.length })}
          </span>
        </div>
      )}
    </div>
  );
}

/** One page of the strip. Its own component so the load callback is stable and a page is read once, not on every render. */
function StripImg({ page, filter, onLoaded, onRetry }: {
  page: PanelPage; filter?: string; onLoaded: (key: string, img: HTMLImageElement) => void; onRetry?: ReaderImageRetry;
}) {
  const loaded = useCallback((img: HTMLImageElement) => onLoaded(page.key, img), [onLoaded, page.key]);
  return <ReaderImg onRetry={onRetry} src={page.src} alt={tr('Page {n}', { n: page.number })} className="pointer-events-none block h-full w-full max-w-none" filter={filter} onLoaded={loaded} />;
}
