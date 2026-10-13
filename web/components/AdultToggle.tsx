'use client';
import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { adultShown, setAdultShown, onAdultChange } from '@/lib/adult';
import { t as tr } from '@/lib/i18n';

export interface LibraryRow { id: string; name: string; adult?: boolean; defaultVisible?: boolean }

/** The library list, shared by the toggle and by whatever renders library tabs. */
export function useLibraries() {
  return useQuery({
    queryKey: ['libraries'],
    queryFn: () => api<LibraryRow[]>('/api/libraries'),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
  });
}

/**
 * Whether the server's 18+ filter names any genre or source (Admin → Settings → 18+ filter), as this
 * viewer meets it.
 *
 * The toggle's own check only knows about 18+ LIBRARIES. An install whose only adult content is a genre on
 * that list (the common case the setting exists for) had the filter on and no switch to turn it off on
 * Library or Home, so the screens that show library series pass this as `alsoWhen` -- the same way
 * Discover passes its hidden-source count. A yes/no only: the lists themselves are admin settings. Always
 * asked without `adult=1`, and the answer does not depend on the reveal, so it has one key.
 */
export function useAdultFilterConfigured(): boolean {
  const { data } = useQuery({
    queryKey: ['adult-filter'],
    queryFn: () => api<{ configured: boolean }>('/api/adult-filter'),
    staleTime: 5 * 60 * 1000,
  });
  return data?.configured === true;
}

/** Whether 18+ is currently revealed, kept in sync with the cookie another tab may have changed. */
export function useAdultShown(): boolean {
  // Starts false and is corrected after mount: this app is a static export, so the first render happens at
  // build time where there is no document to read a cookie from, and guessing would mean a hydration
  // mismatch on every load for anyone who had revealed.
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(adultShown());
    sync();
    const off = onAdultChange(sync);
    // Another tab can flip it, and returning to a backgrounded tab is when a stale one would be noticed.
    window.addEventListener('focus', sync);
    return () => { off(); window.removeEventListener('focus', sync); };
  }, []);
  return on;
}

/** While 18+ is revealed: a pill pinned to the screen on every page that says so and hides it again in one tap. Nothing renders while it is off. */
export function AdultBar() {
  const qc = useQueryClient();
  const on = useAdultShown();
  if (!on) return null;
  return (
    <div data-adult-bar className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 lg:bottom-5">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-amber-300/30 bg-ink-950/90 py-1.5 ps-4 pe-1.5 shadow-lg backdrop-blur">
        <span role="status" data-adult-notice className="min-w-0 text-xs text-amber-200">{tr('18+ titles are showing.')}</span>
        <button type="button" onClick={() => { setAdultShown(false); qc.invalidateQueries(); }}
          className="chip chip-active shrink-0 whitespace-nowrap text-xs">{tr('Hide 18+')}</button>
      </div>
    </div>
  );
}
