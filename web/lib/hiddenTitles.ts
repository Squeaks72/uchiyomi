'use client';
// Titles marked 18+ from a card's menu in this tab, so a card can disappear the moment it is marked.
//
// The server remembers the mark (bff/src/lib/adultTitles.ts) and drops the title from every listing it serves while
// the viewer is hiding 18+. But the lists on screen were fetched before the mark, and a Discover wall is built from
// many slow source answers that nobody wants to ask again, so the page filters its own copy with this as well.
// Nothing here is persisted: a reload asks the server, which already knows.
import { useCallback, useSyncExternalStore } from 'react';
import { useAdultShown } from '@/components/AdultToggle';

/** A title folded for comparison. The same fold as the server's `titleKey`, so both sides agree on "same title". */
export function titleKey(title: string): string {
  return String(title ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

let hidden: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

// A library series is also hidden by its id: the card a person marked may carry a different title (an edition's, an
// alternative one) than the menu was opened with, and the same series sits on other shelves under yet another.
const idKey = (id: string) => `series:${id}`;

export function hideTitle(title: string, seriesId?: string): void {
  const keys = [titleKey(title), seriesId ? idKey(seriesId) : ''].filter((k) => k && !hidden.has(k));
  if (!keys.length) return;
  hidden = new Set([...hidden, ...keys]);
  emit();
}

export function unhideTitle(title: string, seriesId?: string): void {
  const keys = [titleKey(title), seriesId ? idKey(seriesId) : ''].filter((k) => k && hidden.has(k));
  if (!keys.length) return;
  const next = new Set(hidden);
  for (const k of keys) next.delete(k);
  hidden = next;
  emit();
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const snapshot = () => hidden;
const server = (): ReadonlySet<string> => new Set();

/** Whether a title should be left off the screen now. Never, while 18+ is revealed: the reader asked to see it. */
export function useIsHiddenTitle(): (title: string, seriesId?: string) => boolean {
  const set = useSyncExternalStore(subscribe, snapshot, server);
  const revealed = useAdultShown();
  return useCallback(
    (title: string, seriesId?: string) => !revealed && set.size > 0 && (set.has(titleKey(title)) || (!!seriesId && set.has(idKey(seriesId)))),
    [set, revealed],
  );
}
