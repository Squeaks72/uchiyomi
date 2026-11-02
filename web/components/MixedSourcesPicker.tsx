'use client';
// Mixed sources, in one place (fork): every source its extension flags 18+ (or the admin rated Adult only), with a switch for each,
// as the chips-and-search the long lists use (ChipPicker). Used by Admin -> Settings -> 18+ filter and by Discover's Sources sheet,
// where an admin can put a source that Show 18+ is keeping out back into the search without leaving the page.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { ChipPicker } from '@/components/ChipPicker';
import { t as tr } from '@/lib/i18n';
import { ageRequest } from '@/lib/sourceAge';
import { OVERVIEW_KEY, OVERVIEW_URL, type OverviewSource, type SourcesOverview } from '@/lib/sourcesPanel';

/**
 * Mixed sources, in one place (fork): every source its extension flags 18+, with a switch for each. A flagged source is out of
 * Discover and search while Show 18+ is off, mainstream ones like MangaDex EN, Weeb Central or Tapas included, because an extension
 * flags the WHOLE site if it can carry anything adult. Mixed keeps it in, and judges each title (adult genres and ratings stay out).
 * The same PUT as the source's own sheet (Age rating); Adult only is that sheet's.
 */
export function MixedSourcesPicker() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: OVERVIEW_KEY, queryFn: () => api<SourcesOverview>(OVERVIEW_URL), staleTime: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const flagged = (data?.sources ?? []).filter((s) => !s.backup && ((s.defaultAgeRating ?? 0) >= 18 || (s.ageRating ?? 0) >= 18 || s.mixed));
  if (!flagged.length) return null;
  const set = async (s: OverviewSource, mixed: boolean) => {
    setBusy(s.id);
    try {
      await api(`/api/admin/sources/${encodeURIComponent(s.id)}/age-rating`, { method: 'PUT', json: ageRequest(mixed ? 'mixed' : 'default') });
      await qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
      void qc.invalidateQueries({ queryKey: ['sources'] });
      void qc.invalidateQueries({ queryKey: ['adult-filter'] });
    } catch { toast(tr('Could not save'), 'error'); }
    setBusy(null);
  };
  return (
    <div className="py-3" data-mixed-sources>
      <p className="mb-2 max-w-prose text-[11px] leading-relaxed text-fog-500">
        {tr('Sources their extension marks 18+. Tick the ones that are mostly not, to keep searching them while “Show 18+” is off: each title is judged on its own.')}
      </p>
      <ChipPicker label={tr('Sources')} disabled={busy !== null} options={flagged.map((s) => ({ key: s.id, label: s.name }))}
        selected={flagged.filter((s) => s.mixed).map((s) => s.id)}
        onToggle={(k) => { const s = flagged.find((x) => x.id === k); if (s) void set(s, !s.mixed); }} />
    </div>
  );
}
