'use client';
import { BackLink, Breadcrumb } from '@/components/BackLink';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Series } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { LIST_SORTS, listSortOf, sortList, withListSort, type ListSort } from '@/lib/listSort';
import { SeriesTile } from '@/components/cards';
import { Sheet, useRtl, FIELD_CLS, ToggleChip } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { IcChevronLeft, IcChevronRight, IcTrash } from '@/components/icons';
import { t as tr } from '@/lib/i18n';
import { AddSeriesDialog } from '@/components/AddSeriesDialog';
import { Img } from '@/components/ui';
import { canDownload } from '@/lib/auth';
import { useExportList } from '@/components/ListShare';
import { startExport } from '@/lib/exports';
import { SelectionMenu } from '@/components/SelectionMenu';
import { CollectionPickerModal } from '@/components/CollectionPicker';
import { selectedText } from '@/lib/counted';

/** The note with any http(s) address made a link; everything else stays plain text. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <>
      {parts.map((p, i) => i % 2 ? (
        <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-accent underline break-all">{p}</a>
      ) : p)}
    </>
  );
}

function ListNote({ id, value }: { id: string; value: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/collections/${id}`, { method: 'PATCH', json: { description: text } });
      qc.invalidateQueries({ queryKey: ['collection', id] });
      qc.invalidateQueries({ queryKey: ['collections'] });
      setOpen(false);
    } catch { toast(tr('Could not do that'), 'error'); }
    setBusy(false);
  };
  if (open) {
    return (
      <div className="mt-3 max-w-2xl" data-list-note-edit>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4000} dir="auto" autoFocus
          aria-label={tr('List description')} placeholder={tr('Where this list came from, a link, a note…')}
          className={FIELD_CLS} />
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={save} disabled={busy} className="btn-accent px-3 text-xs disabled:opacity-50">{tr('Save')}</button>
          <button type="button" onClick={() => { setText(value); setOpen(false); }} className="chip text-xs">{tr('Cancel')}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 max-w-2xl" data-list-note>
      {value && <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-fog-300"><Linked text={value} /></p>}
      <button type="button" onClick={() => { setText(value); setOpen(true); }} className={`${value ? 'mt-1' : ''} text-xs text-fog-500 underline-offset-2 hover:text-fog-100 hover:underline`}>
        {value ? tr('Edit description') : tr('Add a description')}
      </button>
    </div>
  );
}

interface Want { key: string; title: string; coverUrl: string | null }
interface CollectionDetail { id: string; name: string; accent: string | null; description?: string | null; builtin?: boolean; items: Series[]; wants?: Want[] }

/**
 * A list's orders (#164) as the Library's sort chips: one definition, in a row on a wide screen and in a sheet on a
 * phone, the way the Library places its own (components/LibraryFilters.tsx).
 */
function SortChips({ value, onPick }: { value: ListSort; onPick: (s: ListSort) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {LIST_SORTS.map((s) => (
        <ToggleChip key={s.key} on={value === s.key} onClick={() => onPick(s.key)} data-list-sort={s.key}
          className="text-xs">{tr(s.label)}</ToggleChip>
      ))}
    </div>
  );
}

function CollectionInner() {
  const id = useSearchParams().get('id') || '';
  const qc = useQueryClient();
  const toast = useToast();
  const rtl = useRtl();
  const { user, setSettings, isAdmin } = useAuth();
  const exportList = useExportList();
  const [bringing, setBringing] = useState<Want | null>(null);
  // Edit: remove series and move them in the list's own order. It replaced the old hover-only bin on each cover, which
  // a touchscreen could not see and which now sat on the unread badge.
  const [editing, setEditing] = useState(false);
  const [sorting, setSorting] = useState(false);
  // Select: tick series (or right-click one) to act on several at once. Apart from Edit, which is for ordering.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [listing, setListing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['collection', id],
    queryFn: () => api<CollectionDetail>(`/api/collections/${id}`),
    enabled: !!id,
  });
  // The list's own order, as the server keeps it.
  const items = useMemo(() => data?.items ?? [], [data]);
  const wants = useMemo(() => data?.wants ?? [], [data]);
  const chosen = listSortOf(user?.settings, id);
  // While editing, the list's own order whatever the chosen sort: it is the order the arrows move.
  const sort: ListSort = editing ? 'manual' : chosen;
  const shown = useMemo(() => sortList(items, sort), [items, sort]);
  const active = LIST_SORTS.find((s) => s.key === chosen) ?? LIST_SORTS[0];

  const inval = () => {
    qc.invalidateQueries({ queryKey: ['collection', id] });
    qc.invalidateQueries({ queryKey: ['collections'] });
  };

  // Kept on the account (lib/listSort.ts says why), applied at once and put back if the server refuses it.
  const pickSort = async (next: ListSort) => {
    setSorting(false);
    if (next === chosen) return;
    const prev = user?.settings?.listSorts;
    const map = withListSort(prev, id, next);
    setSettings({ listSorts: map });
    try { await api('/api/settings', { method: 'PUT', json: { listSorts: map } }); }
    catch { setSettings({ listSorts: prev }); toast(tr('Could not save'), 'error'); }
  };

  useEffect(() => { setSelecting(false); setPicked(new Set()); }, [id, editing]);
  const togglePick = (sid: string) => setPicked((p) => { const n = new Set(p); if (n.has(sid)) n.delete(sid); else n.add(sid); return n; });
  const leaveSelect = () => { setSelecting(false); setPicked(new Set()); };

  const removePicked = async () => {
    const ids = [...picked];
    const results = await Promise.allSettled(ids.map((sid) => api(`/api/collections/${id}/items/${sid}`, { method: 'DELETE' })));
    const failed = results.filter((r) => r.status === 'rejected').length;
    inval();
    if (failed) toast(failed === 1 ? tr('1 could not be removed') : tr('{n} could not be removed', { n: failed }), 'error');
    else toast(ids.length === 1 ? tr('Removed 1 series from this list') : tr('Removed {n} series from this list', { n: ids.length }), 'success');
    leaveSelect();
  };

  const zipPicked = () => {
    startExport({ seriesIds: [...picked] })
      .then(() => toast(tr('Zipping started. Follow it at the bottom of the screen.'), 'success'))
      .catch(() => toast(tr('Nothing on the server to zip yet. Fetch some chapters first.'), 'error'));
  };

  const bulkMark = async (path: string, extra: Record<string, unknown>) => {
    try {
      await api(path, { json: { seriesIds: [...picked], ...extra } });
      qc.invalidateQueries({ queryKey: ['favorite-ids'] });
      qc.invalidateQueries({ queryKey: ['collection', id] });
      qc.invalidateQueries({ queryKey: ['home'] });
      leaveSelect();
    } catch { toast(tr('Could not do that'), 'error'); }
  };

  const removeItem = async (s: Series) => {
    try { await api(`/api/collections/${id}/items/${s.id}`, { method: 'DELETE' }); inval(); }
    catch { toast(tr('Could not do that'), 'error'); }
  };

  const dropWant = async (w: Want) => {
    try { await api(`/api/collections/${id}/wants/${encodeURIComponent(w.key)}`, { method: 'DELETE' }); inval(); }
    catch { toast(tr('Could not do that'), 'error'); }
  };

  const move = async (s: Series, dir: -1 | 1) => {
    const ids = items.map((x) => x.id);
    const idx = ids.indexOf(s.id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= ids.length) return;
    [ids[idx], ids[to]] = [ids[to], ids[idx]];
    try { await api(`/api/collections/${id}/items`, { method: 'PUT', json: { seriesIds: ids } }); inval(); }
    catch { toast(tr('Could not change the order'), 'error'); }
  };

  return (
    <div className="min-h-screen-d">
      <div className="px-4 lg:px-0"><Breadcrumb trail={[{ label: tr('Home'), href: '/' }, { label: tr('Lists'), href: '/collections/' }]} current={data?.name || '…'} /></div>
      <header className="safe-top px-4 pb-2 lg:px-0">
        <div className="flex items-center gap-2">
          <BackLink fallback="/collections/" phoneOnly />
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: data?.accent || 'rgb(var(--accent))' }} />
            <h1 className="truncate font-display text-2xl font-bold lg:text-3xl">{data?.name || '…'}</h1>
          </div>
        </div>
        {data && !data.builtin && <ListNote key={data.description ?? ''} id={id} value={data.description ?? ''} />}
        {(items.length > 0 || wants.length > 0 || editing) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!editing && (
              <>
                {/* On a phone the chip names the order and opens the sheet; from lg up the chips are simply there. */}
                <button type="button" onClick={() => setSorting(true)} aria-haspopup="dialog" data-list-sort-open
                  className={`chip text-xs lg:hidden ${chosen !== 'manual' ? 'chip-active' : ''}`}>
                  {tr('Sort by')} · {tr(active.label)}
                </button>
                <div className="hidden items-center gap-3 lg:flex">
                  <span className="text-xs font-semibold uppercase tracking-wider text-fog-500">{tr('Sort by')}</span>
                  <SortChips value={chosen} onPick={pickSort} />
                </div>
              </>
            )}
            {!editing && data && <button type="button" onClick={() => void exportList(id, data.name)} data-list-export className="chip ms-auto text-xs">{tr('Export')}</button>}
            {!editing && data && <button type="button" data-list-zip className="chip text-xs"
              onClick={() => startExport({ collectionId: id })
                .then(() => toast(tr('Zipping started. Follow it at the bottom of the screen.'), 'success'))
                .catch(() => toast(tr('Nothing on the server to zip yet. Fetch some chapters first.'), 'error'))}>{tr('Download as zip')}</button>}
            {!editing && items.length > 0 && (
              <button type="button" onClick={() => { setSelecting((v) => !v); setPicked(new Set()); }} aria-pressed={selecting} data-list-select
                className={`chip text-xs ${selecting ? 'chip-active' : ''}`}>
                {selecting ? tr('Done') : tr('Select')}
              </button>
            )}
            {selecting && items.length > 0 && (
              <button type="button" onClick={() => setPicked(new Set(items.map((x) => x.id)))} className="chip text-xs">{tr('Select all')}</button>
            )}
            {!data?.builtin && (
              <button type="button" onClick={() => setEditing((v) => !v)} aria-pressed={editing} data-list-edit
                className={`chip text-xs ${editing ? 'chip-active ms-auto' : ''}`}>
                {editing ? tr('Done') : tr('Edit')}
              </button>
            )}
          </div>
        )}
      </header>

      {isLoading ? (
        <div role="status" aria-busy="true" className="grid grid-cols-3 gap-3 px-4 pt-3 sm:grid-cols-4 lg:grid-cols-6 lg:px-0 2xl:grid-cols-8">
          <span className="sr-only">{tr('Loading…')}</span>
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />)}
        </div>
      ) : items.length === 0 && !wants.length ? (
        <p className="px-4 pt-10 text-center text-sm text-fog-500 lg:px-0">{data?.builtin ? tr('Nothing yet — tap the heart on a series to add it here.') : tr('Empty so far — open any series and use “Add to collection”.')}</p>
      ) : (
        // The Library's own tile (#164): the same unread count, NEW mark, favourite and offline marks, from the same
        // per-reader numbers, and the same right-click menu.
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 px-4 pt-3 sm:grid-cols-4 lg:grid-cols-6 lg:px-0 2xl:grid-cols-8">
          {shown.map((s, i) => editing ? (
            <div key={s.id} className="relative">
              {/* The tile as it reads everywhere, held still: in Edit a press is for the keys over it. */}
              <div inert className="pointer-events-none"><SeriesTile series={s} /></div>
              {/* Over the cover alone (its 2:3 box), not the title under it, and above the tile's own marks (z-10): the
                  keys sit in the corners the count and the heart use, and a key under a mark is a key half hidden. */}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex aspect-[2/3] flex-col justify-between p-1.5">
                <div className="flex justify-end">
                  <button type="button" onClick={() => removeItem(s)} aria-label={tr('Remove from collection')}
                    className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full bg-black/70 text-fog-100 backdrop-blur hover:text-white">
                    <IcTrash width={14} height={14} />
                  </button>
                </div>
                {shown.length > 1 && (
                  <div className="flex justify-between">
                    {/* Earlier is toward the start of the line, so in Arabic the pair mirrors. */}
                    <button type="button" onClick={() => move(s, -1)} disabled={i === 0} aria-label={tr('Move earlier')}
                      className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white backdrop-blur disabled:invisible">
                      {rtl ? <IcChevronRight width={16} height={16} /> : <IcChevronLeft width={16} height={16} />}
                    </button>
                    <button type="button" onClick={() => move(s, 1)} disabled={i === shown.length - 1} aria-label={tr('Move later')}
                      className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white backdrop-blur disabled:invisible">
                      {rtl ? <IcChevronLeft width={16} height={16} /> : <IcChevronRight width={16} height={16} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div key={s.id} className="contents" onContextMenu={(e) => {
              e.preventDefault();
              if (!selecting) { setSelecting(true); setPicked(new Set([s.id])); }
              else if (!picked.has(s.id)) setPicked((p) => new Set(p).add(s.id));
              setMenu({ x: e.clientX, y: e.clientY });
            }}>
              <SeriesTile series={s} selectable={selecting} selected={picked.has(s.id)} onToggle={() => togglePick(s.id)} />
            </div>
          ))}
        </div>
      )}

      {wants.length > 0 && (
        <section className="px-4 pt-8 lg:px-0" data-list-wants>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-fog-500">{tr('Not in your library yet')}</h2>
          <p className="mb-3 text-xs text-fog-500">{tr('Saved here to add later. They join the list on their own once the library has them.')}</p>
          <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
            {wants.map((w) => (
              <li key={w.key} className="min-w-0">
                <div className="relative">
                  <Img src={w.coverUrl || ''} alt="" className="aspect-[2/3] w-full rounded-2xl border border-ink-700 opacity-80" />
                  <button type="button" onClick={() => dropWant(w)} aria-label={tr('Remove from collection')}
                    className="absolute end-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-fog-100 backdrop-blur hover:text-white">
                    <IcTrash width={14} height={14} />
                  </button>
                </div>
                <p dir="auto" className="mt-1.5 line-clamp-2 text-xs font-medium text-fog-100">{w.title}</p>
                {canDownload(user) && (
                  <button type="button" onClick={() => setBringing(w)} data-want-add className="chip mt-1.5 w-full justify-center text-[11px]">{tr('Add to library')}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {bringing && (
        <AddSeriesDialog seed={{ kind: 'trending', title: bringing.title }} sources={[]} mayFollow={isAdmin}
          onClose={() => setBringing(null)} onAdded={inval} />
      )}

      {selecting && picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 border-t border-ink-700 bg-ink-950/95 px-4 pb-3 pt-3 backdrop-blur-xl lg:bottom-0 lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-list-selection>
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 lg:max-w-5xl">
            <span role="status" className="me-auto text-sm font-medium text-fog-100">{selectedText(picked.size)}</span>
            {!data?.builtin && <button type="button" onClick={() => void removePicked()} data-list-remove-selected className="btn-key">{tr('Remove from this list')}</button>}
            <button type="button" onClick={() => setListing(true)} className="chip text-xs">{tr('Add to list')}</button>
            <button type="button" onClick={zipPicked} className="chip text-xs">{tr('Download as zip')}</button>
            <button type="button" onClick={leaveSelect} className="chip text-xs text-fog-500">{tr('Cancel')}</button>
          </div>
        </div>
      )}
      {listing && <CollectionPickerModal seriesIds={[...picked]} onClose={() => setListing(false)} onDone={() => { setListing(false); leaveSelect(); }} />}
      {menu && picked.size > 0 && (
        <SelectionMenu at={menu} onClose={() => setMenu(null)} title={selectedText(picked.size)}
          items={[
            ...(!data?.builtin ? [{ label: tr('Remove from this list'), run: () => void removePicked(), danger: true }] : []),
            { label: tr('Add to list'), run: () => setListing(true) },
            { label: tr('Download as zip'), run: zipPicked },
            { label: tr('Mark read'), run: () => void bulkMark('/api/library/bulk/read', { completed: true }) },
            { label: tr('Mark unread'), run: () => void bulkMark('/api/library/bulk/read', { completed: false }) },
            { label: tr('Favorite'), run: () => void bulkMark('/api/favorites/bulk', { favorite: true }) },
            { label: tr('Select all'), run: () => setPicked(new Set(items.map((x) => x.id))) },
          ]} />
      )}

      {sorting && (
        <Sheet title={tr('Sort by')} onClose={() => setSorting(false)} overBottomNav>
          <div className="pb-2"><SortChips value={chosen} onPick={pickSort} /></div>
        </Sheet>
      )}
    </div>
  );
}

export default function CollectionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen-d" />}>
      <CollectionInner />
    </Suspense>
  );
}

