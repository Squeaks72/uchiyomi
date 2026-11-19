'use client';
import { useSyncExternalStore } from 'react';

/**
 * Effects are OFF, for everyone, always (fork, 2026-11-19).
 *
 * This used to be the Reduce effects switch (#71): the drifting accent mesh, film grain, vignette, glass that
 * blurs what scrolls under it, momentum scrolling (Lenis), card tilt and covers that sharpen in were the
 * default, and the switch turned them off. Three rounds of tuning later, scrolling with them on was still
 * choppy on a gaming PC, so the plain mode is now the only mode and the switch is gone.
 *
 * Everything downstream still asks this module (about 40 call sites read `useReduceEffects()` /
 * `effectsReduced()`, and app/globals.css keys on `html.reduce-effects`), so the answer is simply fixed at
 * true here rather than unpicked at every site -- which keeps the nightly upstream rebase painless.
 * The class is also written into <html> by app/layout.tsx, so it is there from the first byte.
 *
 * `prefers-reduced-motion` still does what it always did, on top of this.
 */

const CLASS = 'reduce-effects';

/** Kept for callers (lib/auth.tsx, app/providers.tsx): any value means "on". */
export function applyReduceEffects(_on?: boolean): void {
  try { document.documentElement.classList.add(CLASS); } catch { /* no document: nothing to style */ }
}

export function restoreReduceEffects(): void {
  applyReduceEffects();
}

export function readReduceEffectsMirror(): boolean {
  return true;
}

export function effectsReduced(): boolean {
  return true;
}

const subscribe = () => () => {};
const yes = () => true;

export function useReduceEffects(): boolean {
  return useSyncExternalStore(subscribe, yes, yes);
}
