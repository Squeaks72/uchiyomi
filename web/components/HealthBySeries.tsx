'use client';
// Health, turned around: one card per series with everything wrong with it and the ways to fix it, instead of one card
// per check. Only findings about a single series appear here; library-wide ones stay in the check view.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { HealthCheck } from '@/lib/types';
import { t as tr } from '@/lib/i18n';
import { checkTitle } from '@/lib/healthCopy';
import { itemDetail } from '@/lib/said';
import { seriesHref } from '@/lib/healthLinks';
import { FindSourceLink, SeriesRowTools } from '@/components/FindSourceLink';
import { ConfirmDialog, msgOf } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';

interface Problem { check: string; label: string; detail: string }
interface Row { id: string; title: string; problems: Problem[]; checks: Set<string> }

const KEY = 'text-xs text-accent hover:underline';

export function HealthBySeries({ checks }: { checks: HealthCheck[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const by = new Map<string, Row>();
    for (const c of checks) {
      if (c.id === 'duplicates') continue;
      for (const it of c.items) {
        if (!it.seriesId || it.info) continue;
        const r = by.get(it.seriesId) ?? { id: it.seriesId, title: it.title, problems: [], checks: new Set<string>() };
        r.problems.push({ check: c.id, label: checkTitle(c), detail: itemDetail(it) });
        r.checks.add(c.id);
        by.set(it.seriesId, r);
      }
    }
    return [...by.values()].sort((a, b) => b.problems.length - a.problems.length || a.title.localeCompare(b.title));
  }, [checks]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const removeAll = async () => {
    setBusy(true);
    let failed = 0;
    for (const id of picked) {
      try { await api(`/api/admin/series/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { failed++; if (failed === 1) toast(msgOf(e, tr('Could not remove it')), 'error'); }
    }
    if (failed < picked.size) toast(tr('Series removed from the library'), 'success');
    setPicked(new Set());
    setAsking(false);
    for (const k of [['admin-health'], ['health-summary'], ['home'], ['library']]) qc.invalidateQueries({ queryKey: k });
    setBusy(false);
  };

  if (!rows.length) return <p role="status" className="full py-10 text-center text-sm text-fog-500">{tr('No single series has a problem right now.')}</p>;
  return (
    <div className="full space-y-3" data-health-by-series>
      <div className="flex flex-wrap items-center gap-3 text-xs text-fog-400">
        <span>{rows.length === 1 ? tr('1 series needs attention') : tr('{n} series need attention', { n: rows.length })}</span>
        <button type="button" className={KEY} onClick={() => setPicked(new Set(picked.size === rows.length ? [] : rows.map((r) => r.id)))}>
          {picked.size === rows.length ? tr('Select none') : tr('Select all')}
        </button>
        {picked.size > 0 && <button type="button" className="btn-key" onClick={() => setAsking(true)}>{tr('Remove {n} from library', { n: picked.size })}</button>}
      </div>
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-ink-700 bg-ink-900/40 p-3">
          <div className="flex items-start gap-2.5">
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={r.title} className="mt-1 size-4 accent-accent" />
            <div className="min-w-0 flex-1">
              <p dir="auto" className="break-words text-sm text-fog-100">{r.title}</p>
              <ul className="mt-1 space-y-0.5">
                {r.problems.map((p, i) => (
                  <li key={i} dir="auto" className="text-[11px] text-fog-500"><span className="text-fog-300">{p.label}</span> · {p.detail}</li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Link href={seriesHref(r.id)} className={KEY}>{tr('Open')}{' '}›</Link>
                <FindSourceLink id={r.id} className={KEY} />
                <SeriesRowTools id={r.id} title={r.title} details={r.checks.has('details') || r.checks.has('covers')} className={KEY} />
              </div>
            </div>
          </div>
        </div>
      ))}
      {asking && (
        <ConfirmDialog title={tr('Remove from library?')} danger twoStep busy={busy} confirmLabel={tr('Remove')}
          body={(
            <>
              <p><strong className="text-fog-100">{tr('No files are deleted.')}</strong>{' '}{tr('The chapters stay exactly where they are on disk, and nothing in your library folder is touched.')}</p>
              <p className="mt-2">{tr('Everyone’s reading progress, history, favourites and ratings are kept, so you can put it back at any time from Admin → Library, or just add it again.')}</p>
            </>
          )}
          onConfirm={removeAll} onClose={() => setAsking(false)} />
      )}
    </div>
  );
}
