'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t as tr } from '@/lib/i18n';
import { hideTitle, titleKey, unhideTitle } from '@/lib/hiddenTitles';
import { useAdultShown } from './AdultToggle';
import { useToast } from './Toast';
import type { MenuItem } from './ContextMenu';

/**
 * "Mark as 18+" for a card's menu (admins only: the mark is shared, so it is the admin console's to give).
 *
 * Marking writes the title's mark, which hides every copy of it on Discover, and -- for a card that is a library
 * series -- the series' own age rating too. The card then leaves the screen at once (lib/hiddenTitles.ts); the
 * server keeps it hidden after that. While 18+ is revealed nothing disappears, so the same item reads "Clear 18+
 * mark" and takes it back.
 */
export function useAdultMark(title: string, seriesId?: string, seriesRating?: number | null): MenuItem[] {
  const { isAdmin, status } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const revealed = useAdultShown();
  const marks = useQuery({
    queryKey: ['adult-titles'], enabled: isAdmin && revealed, staleTime: 60_000,
    queryFn: () => api<{ content: Array<{ key: string }> }>('/api/admin/adult-titles').then((r) => r.content.map((m) => m.key)),
  });
  if (!isAdmin) return [];
  const marked = revealed && ((seriesRating ?? 0) >= 18 || !!marks.data?.includes(titleKey(title)));
  const set = async (adult: boolean) => {
    try {
      await api('/api/admin/adult-titles', { json: { title, adult } });
      if (seriesId) await api(`/api/admin/series/${encodeURIComponent(seriesId)}/adult`, { json: { adult } });
    } catch { toast(tr('Could not do that'), 'error'); return; }
    if (adult) hideTitle(title, seriesId); else unhideTitle(title, seriesId);
    for (const key of [['adult-titles'], ['library'], ['home'], ['series'], ['discover-trending'], ['discover-recommendations'], ['adult-filter'], ['foryou'], ['trending'], ['featured'], ['because'], ['collection'], ['collections'], ['updates']]) {
      qc.invalidateQueries({ queryKey: key });
    }
    // While 18+ is shown nothing leaves the screen, so "hidden" would be untrue.
    toast(adult ? (revealed ? tr('Marked 18+') : tr('Marked 18+ and hidden. Turn on Show 18+ to find it again.')) : tr('18+ mark cleared'), 'success');
  };
  return [{
    label: marked ? tr('Clear 18+ mark') : tr('Mark as 18+'), divider: true, disabled: status === 'offline', hook: 'mark-adult',
    onSelect: () => set(!marked),
  }];
}

/**
 * "Always show" for a series' menu (admins only, like the mark: it is the shared switch from Edit details). The 18+
 * filter then never hides this one series, however its genres read. `exempt` is known only where the card carries the
 * admin's overrides (the series page); elsewhere the item sets it, and the series page takes it back.
 */
export function useAlwaysShow(seriesId: string | undefined, exempt?: boolean): MenuItem[] {
  const { isAdmin, status } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  if (!isAdmin || !seriesId) return [];
  const set = async (show: boolean) => {
    try { await api(`/api/admin/series/${encodeURIComponent(seriesId)}/always-show`, { json: { show } }); }
    catch { toast(tr('Could not do that'), 'error'); return; }
    for (const key of [['library'], ['home'], ['series'], ['search'], ['adult-filter'], ['collection'], ['collections'], ['updates']]) qc.invalidateQueries({ queryKey: key });
    toast(show ? tr('Always shown: the 18+ filter will not hide it') : tr('Back under the 18+ filter'), 'success');
  };
  return [{
    label: exempt ? tr('Stop always showing') : tr('Always show (ignore 18+ filter)'), disabled: status === 'offline', hook: 'always-show',
    onSelect: () => set(!exempt),
  }];
}
