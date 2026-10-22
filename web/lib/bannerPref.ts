'use client';
import { useSyncExternalStore } from 'react';

/**
 * The big hero banners on Home (the daily pick) and Discover (trending now): off by default, and this device's choice
 * (localStorage) -- the fork's own switch, so there is no upstream setting to ride on.
 */
const KEY = 'uchiyomi.showBanners';
const listeners = new Set<() => void>();

export function bannersOn(): boolean {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

export function setBannersOn(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, 'on'); else localStorage.removeItem(KEY); } catch { /* private mode: this session keeps it */ }
  for (const l of listeners) l();
}

/** The switch, live: `[on, set]`. Server render and first paint say off. */
export function useBanners(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (cb) => { listeners.add(cb); window.addEventListener('storage', cb); return () => { listeners.delete(cb); window.removeEventListener('storage', cb); }; },
    bannersOn, () => false);
  return [on, setBannersOn];
}
