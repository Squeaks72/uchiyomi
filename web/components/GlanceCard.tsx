'use client';
// A series at a glance: the start of its description over its thumbnail while the pointer is on it, and a
// "Read more…" that opens the lot -- a large cover, the description in full, other names, genres and facts, and
// the buttons to read it or add it. One hook for every wall (the library's, Discover's, a trending rail), so
// they all say the same things in the same place.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t as tr } from '@/lib/i18n';
import type { Glance } from '@/lib/glance';
import type { Book } from '@/lib/types';
import { Img, OnBody } from './ui';
import { Modal } from './ConfirmDialog';

export interface GlanceAction {
  label: string;
  primary?: boolean;
  href?: string;
  onClick?: () => void | Promise<void>;
}

interface Options {
  /** The cover, large: the card opens it at this size beside the text. */
  cover: string;
  fallbackCover?: string;
  /** A library series: the card gets a Read button that opens the chapter to continue from. */
  readSeriesId?: string;
  actions?: GlanceAction[];
}

/** Does the card have anything to say? A source that gave no description, genres or facts has no card. */
export const hasGlance = (g: Glance) => !!(g.text || g.genres.length || g.facts.length || g.altTitles.length);

// Whatever is clicked, typed or pressed in the open card must not reach the thumbnail it was opened from: the
// portal moves the DOM, but React still bubbles events to the card's link, which would open the series.
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

export function useGlance(g: Glance, o: Options) {
  const [open, setOpen] = useState(false);
  const has = hasGlance(g);
  const peekText = g.short || g.genres.slice(0, 4).join(' · ');

  const overlay = !has ? null : (
    <span data-blurb
      className="pointer-events-none absolute inset-0 z-[5] flex flex-col justify-end gap-1 bg-linear-to-t from-black/95 via-black/80 to-black/25 p-2 pb-9 text-start opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:hidden">
      {peekText && <span dir="auto" className="line-clamp-6 text-[11px] leading-snug text-fog-100">{peekText}</span>}
      <span role="button" tabIndex={-1} data-glance-more
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="pointer-events-auto w-fit cursor-pointer text-[11px] font-semibold text-accent hover:underline">
        {g.text ? tr('Read more…') : tr('Details…')}
      </span>
    </span>
  );

  const modal = open ? (
    <OnBody>
      <div onClick={stop} onContextMenu={stop} onPointerDown={stop} onPointerUp={stop} onTouchStart={stop} onTouchEnd={stop} onKeyDown={stop}>
        <GlanceModal g={g} o={o} onClose={() => setOpen(false)} />
      </div>
    </OnBody>
  ) : null;

  return { has, show: has ? () => setOpen(true) : undefined, overlay, modal };
}

function GlanceModal({ g, o, onClose }: { g: Glance; o: Options; onClose: () => void }) {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  // The names a series is known by are the admin's to read (GET /api/admin/series/:id/alt-titles); everyone else
  // sees the ones the card already carries.
  const names = useQuery({
    queryKey: ['alt-titles', g.altFrom], enabled: isAdmin && !!g.altFrom, staleTime: 5 * 60_000,
    queryFn: () => api<{ titles: { title: string }[] }>(`/api/admin/series/${encodeURIComponent(g.altFrom!)}/alt-titles`),
  });
  const seen = new Set([g.title.trim().toLowerCase()]);
  const others = [...g.altTitles, ...(names.data?.titles ?? []).map((t) => t.title)].filter((n) => {
    const k = n.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const read = async () => {
    if (!o.readSeriesId || busy) return;
    setBusy(true);
    try {
      const r = await api<{ content: Book[] }>(`/api/series/${encodeURIComponent(o.readSeriesId)}/books?page=0&size=500&sort=metadata.numberSort,asc`);
      const list = r.content ?? [];
      const next = list.find((b) => !b.readProgress?.completed && !b.pruned) || list.find((b) => !b.pruned) || list[0];
      onClose();
      router.push(next ? `/reader/?book=${encodeURIComponent(next.id)}` : `/series/?id=${encodeURIComponent(o.readSeriesId)}`);
    } catch {
      onClose();
      router.push(`/series/?id=${encodeURIComponent(o.readSeriesId)}`);
    }
  };
  const actions: GlanceAction[] = [
    ...(o.readSeriesId ? [{ label: tr('Read'), primary: true, onClick: read }] : []),
    ...(o.actions ?? []),
  ];
  const primaryAt = actions.findIndex((a) => a.primary);

  return (
    <Modal title={g.title} onClose={onClose} xwide>
      <div data-glance className="flex flex-col gap-4 sm:flex-row">
        <div className="mx-auto w-44 shrink-0 sm:mx-0 sm:w-52">
          <div className="grad-border relative aspect-[2/3] overflow-hidden rounded-xl border border-ink-700/60 shadow-lift">
            <Img src={o.cover} fallbackSrc={o.fallbackCover} alt="" className="h-full w-full" />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {others.length > 0 && (
            <div data-glance-names>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fog-500">{tr('Also known as')}</p>
              <p dir="auto" className="mt-0.5 text-xs leading-relaxed text-fog-300">{others.slice(0, 8).join(' · ')}</p>
            </div>
          )}
          {g.facts.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {g.facts.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-fog-500">{f.label}</dt>
                  <dd dir="auto" className="min-w-0 text-fog-200">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {g.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {g.genres.map((x) => <span key={x} className="rounded-full border border-ink-700 px-2 py-0.5 text-[11px] text-fog-300">{x}</span>)}
            </div>
          )}
          {g.text
            ? <p dir="auto" data-glance-text data-lenis-prevent className="max-h-64 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-fog-300">{g.text}</p>
            : <p className="text-sm text-fog-500">{tr('No description.')}</p>}
        </div>
      </div>
      {actions.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {actions.map((a, i) => {
            const cls = `${i === primaryAt ? 'btn-accent' : 'btn-ghost'} px-4 py-2 text-sm`;
            return a.href
              ? <Link key={a.label} href={a.href} onClick={onClose} className={cls}>{a.label}</Link>
              : <button key={a.label} type="button" disabled={busy}
                  onClick={async () => { await a.onClick?.(); if (a.onClick !== read) onClose(); }} className={`${cls} disabled:opacity-50`}>{a.label}</button>;
          })}
        </div>
      )}
    </Modal>
  );
}
