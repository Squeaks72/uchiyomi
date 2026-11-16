'use client';
import { useSyncExternalStore } from 'react';

/**
 * Blur the covers of 18+ series on the cards (2026-11-16, from mangadot's optional NSFW blur). This device's choice
 * (localStorage), like the banners switch: a shared tablet and a private phone want different answers. On by default --
 * an 18+ cover only appears once Show 18+ is on, and a library on a screen across the room is when a blur earns its keep;
 * turning it off is one switch in Settings → Appearance. A pointer hovering a card, or focus on it, lifts the blur.
 */
const KEY = 'uchiyomi.blurAdult';
const listeners = new Set<() => void>();

export function blurAdultOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setBlurAdultOn(on: boolean): void {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off'); } catch { /* private mode: this session keeps it */ }
  for (const l of listeners) l();
}

/** The switch, live: `[on, set]`. Server render says on, so an adult cover is never painted sharp first. */
export function useBlurAdult(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (cb) => { listeners.add(cb); window.addEventListener('storage', cb); return () => { listeners.delete(cb); window.removeEventListener('storage', cb); }; },
    blurAdultOn, () => true);
  return [on, setBlurAdultOn];
}

/** A cover's classes in place of its usual ones while blurred: no hover zoom, the blur lifts when the card (`group`) is hovered or focused. */
export const BLURRED_COVER = 'h-full w-full blur-xl scale-110 transition duration-300 group-hover:blur-0 group-hover:scale-100 group-focus-within:blur-0 group-focus-within:scale-100';
