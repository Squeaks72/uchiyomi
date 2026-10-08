'use client';
import { BackLink, Breadcrumb } from '@/components/BackLink';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, img } from '@/lib/api';
import { Series } from '@/lib/types';
import { relativeTime } from '@/lib/format';
import { Img } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { EmptyState } from '@/components/EmptyState';
import { ART } from '@/lib/art';
import { IcBell, IcCheck } from '@/components/icons';
import { t as tr } from '@/lib/i18n';

interface UpdateItem { series: Series; newCount: number; latestAt?: string | null }

export default function UpdatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['updates'], queryFn: () => api<{ content: UpdateItem[] }>('/api/updates') });
  const items = data?.content ?? [];

  const markAll = async () => {
    await api('/api/updates/seen', { method: 'POST' });
    toast(tr('All caught up'), 'success');
    qc.invalidateQueries({ queryKey: ['home'] });
    refetch();
  };

  return (
    <div className="min-h-screen-d">
      <div className="px-4 lg:px-0"><Breadcrumb trail={[{ label: tr('Home'), href: '/' }]} current={tr('Updates')} /></div>
      <header className="safe-top flex items-center gap-2 px-4 pb-2 lg:px-0">
        <BackLink fallback="/" phoneOnly />
        <h1 className="font-display text-2xl font-bold lg:text-3xl">{tr('Updates')}</h1>
        {items.length > 0 && (
          <button type="button" onClick={markAll} className="ms-auto chip text-xs">
            <IcCheck width={14} height={14} />{tr('Mark all read')}</button>
        )}
      </header>

      {isLoading ? (
        <div role="status" aria-busy="true" className="space-y-3 px-4 pt-3 lg:px-0">
          <span className="sr-only">{tr('Loading…')}</span>
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState art={ART.emptyUpdates} title={tr('You’re all caught up')}
          sub={tr('Favorite a series and its new chapters show up here.')}
          cta={{ href: '/library', label: tr('Browse library') }} />
      ) : (
        <div className="space-y-3 px-4 pt-3 lg:mx-auto lg:max-w-2xl lg:px-0">
          {items.map(({ series, newCount, latestAt }) => (
            <Link key={series.id} href={`/series/?id=${series.id}`} className="card flex items-center gap-3 p-3">
              <div className="h-20 w-14 shrink-0 overflow-hidden rounded-xl border border-ink-700">
                <Img src={img.seriesThumb(series.id)} alt="" className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fog-100">{series.metadata?.title || series.name}</p>
                <p className="mt-0.5 text-xs text-accent">
                  {newCount === 1 ? tr('+1 new chapter') : tr('+{n} new chapters', { n: newCount })}
                  {latestAt && <span className="text-fog-500"> · {relativeTime(latestAt)}</span>}
                </p>
              </div>
              <span aria-hidden className="grid h-7 min-w-7 place-items-center rounded-full bg-accent px-2 text-xs font-bold text-black">{newCount}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
