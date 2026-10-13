'use client';
import { BackLink, Breadcrumb } from '@/components/BackLink';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth';
import { EmptyState } from '@/components/EmptyState';
import { ART } from '@/lib/art';
import { IcChevronLeft, IcChevronRight, IcHeart, IcHome, IcPlus, IcTrash } from '@/components/icons';
import { AdultToggle } from '@/components/AdultToggle';
import { ImportListModal, useExportList } from '@/components/ListShare';
import { useRtl } from '@/components/ui';
import { keys, t as tr } from '@/lib/i18n';
import { Modal } from '@/components/ConfirmDialog';
import { useLayer } from '@/lib/layers';
import { ACCENTS, homeIdsOf, isMine, type ListRow } from '@/lib/lists';
import { ListOwnerLine, ListTags } from '@/components/ListBits';
import { invalidateLists, useListsAll } from '@/components/SaveListDialog';

export type CollectionRow = ListRow;

/** A list's name inside a sentence, isolated: in Arabic a Latin name would reorder the words around it. */
const iso = (s: string): string => `⁨${s}⁩`;

// Each swatch's name, for a screen reader; declared so they are translated (see lib/i18n.ts keys).
const ACCENT_NAMES = keys('Violet', 'Pink', 'Cyan', 'Green', 'Amber', 'Red');

export default function CollectionsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const rtl = useRtl();
  const { user, setSettings } = useAuth();
  const [homeSaving, setHomeSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const exportList = useExportList();
  const favs = useQuery({ queryKey: ['favorite-ids'], staleTime: 60_000, queryFn: () => api<{ ids: string[] }>('/api/favorites/ids').then((r) => r.ids) });
  const favCount = favs.data?.length ?? 0;
  // The New collection dialog below is a Modal, which sits on the notices' layer stack (lib/layers.ts) and
  // handles Escape and focus itself.
  const [name, setName] = useState('');
  const [accent, setAccent] = useState<string>(ACCENTS[0]);
  // v0.61.0: every list this reader may read (lib/lists.ts) -- their own, hand-picked and smart, then the household's
  // shared ones -- in two sections. Its own key: ['collections'] stays the plain answer the series page's sheet reads.
  const { data, isLoading } = useListsAll();
  const items = data?.content ?? [];
  const mine = items.filter(isMine);
  const theirs = items.filter((c) => !isMine(c));
  const savedHome = user?.settings?.homeCollections;
  // Until the first edit, mirror Home's legacy first-three-nonempty choice.  An edit writes the complete,
  // valid list and thereby drops deleted or unreadable ids from an older setting. A shared list takes a Home slot
  // like the reader's own (v0.61.0); it never fills one nobody chose for it.
  const homeIds = homeIdsOf(savedHome, items);

  const saveHome = async (next: string[]) => {
    if (homeSaving) return;
    const previous = savedHome;
    setHomeSaving(true);
    setSettings({ homeCollections: next });
    try {
      await api('/api/settings', { method: 'PUT', json: { homeCollections: next } });
      qc.invalidateQueries({ queryKey: ['home'] });
    } catch {
      setSettings({ homeCollections: previous });
      toast(tr('Could not save'), 'error');
    } finally { setHomeSaving(false); }
  };

  const toggleHome = (id: string) => {
    const at = homeIds.indexOf(id);
    if (at >= 0) return void saveHome(homeIds.filter((x) => x !== id));
    if (homeIds.length >= 3) {
      toast(tr('Choose up to 3 lists for Home'), 'error');
      return;
    }
    void saveHome([...homeIds, id]);
  };

  const moveHome = (id: string, by: -1 | 1) => {
    const from = homeIds.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= homeIds.length) return;
    const next = [...homeIds];
    [next[from], next[to]] = [next[to], next[from]];
    void saveHome(next);
  };

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      const c = await api<CollectionRow>('/api/collections', { json: { name: n, accent } });
      toast(tr('List created'), 'success');
      setCreating(false);
      setName('');
      invalidateLists(qc);
      router.push(`/collection/?id=${c.id}`);
    } catch { toast(tr('Could not create the list'), 'error'); }
  };

  const remove = async (c: CollectionRow) => {
    if (!window.confirm(tr('Delete “{name}”? The series stay in your library.', { name: iso(c.name) }))) return;
    try {
      await api(`/api/collections/${c.id}`, { method: 'DELETE' });
      toast(tr('Deleted'), 'success');
      invalidateLists(qc);
    } catch { toast(tr('Failed'), 'error'); }
  };

  /** One list's card: the same for the reader's own and a shared one, which has no Delete and says whose it is. */
  const card = (c: CollectionRow) => (
    <div key={c.id} className="card group relative overflow-hidden p-4">
      <span aria-hidden className="absolute inset-y-0 start-0 w-1.5" style={{ background: c.accent || 'rgb(var(--accent))' }} />
      <Link href={`/collection/?id=${c.id}`} className="block ps-2">
        <p className="font-display text-lg font-semibold text-fog-50">{c.name}</p>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs text-fog-500">{Number(c.item_count) === 1 ? tr('1 series') : tr('{n} series', { n: Number(c.item_count) })}</span>
          <ListTags list={c} />
        </span>
        {c.owner && <ListOwnerLine owner={c.owner} className="mt-1.5" />}
      </Link>
      <div className="mt-3 flex items-center gap-1.5 ps-2">
        <button type="button" onClick={() => toggleHome(c.id)} disabled={homeSaving}
          aria-pressed={homeIds.includes(c.id)}
          className={`chip text-xs disabled:opacity-50 ${homeIds.includes(c.id) ? 'chip-active' : ''}`}>
          <IcHome width={13} height={13} aria-hidden />
          {homeIds.includes(c.id) ? tr('Home {n}', { n: homeIds.indexOf(c.id) + 1 }) : tr('Show on Home')}
        </button>
        {homeIds.includes(c.id) && homeIds.length > 1 && (
          <>
            <button type="button" disabled={homeSaving || homeIds.indexOf(c.id) === 0}
              onClick={() => moveHome(c.id, -1)} aria-label={tr('Move earlier')}
              className="grid h-8 w-8 place-items-center rounded-full border border-ink-700 text-fog-300 disabled:opacity-30">
              {rtl ? <IcChevronRight width={14} height={14} /> : <IcChevronLeft width={14} height={14} />}
            </button>
            <button type="button" disabled={homeSaving || homeIds.indexOf(c.id) === homeIds.length - 1}
              onClick={() => moveHome(c.id, 1)} aria-label={tr('Move later')}
              className="grid h-8 w-8 place-items-center rounded-full border border-ink-700 text-fog-300 disabled:opacity-30">
              {rtl ? <IcChevronLeft width={14} height={14} /> : <IcChevronRight width={14} height={14} />}
            </button>
          </>
        )}
        <button type="button" onClick={() => void exportList(c.id, c.name)} className="chip ms-auto text-xs" data-list-export>{tr('Export')}</button>
      </div>
      {isMine(c) && (
        <button onClick={() => remove(c)} aria-label={tr('Delete “{name}”', { name: iso(c.name) })}
          className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-full border border-ink-700 text-fog-500 opacity-0 transition group-hover:opacity-100">
          <IcTrash width={14} height={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen-d">
      <div className="px-4 lg:px-0"><Breadcrumb trail={[{ label: tr('Home'), href: '/' }]} current={tr('Lists')} /></div>
      <header className="safe-top flex items-center gap-2 px-4 pb-2 lg:px-0">
        <BackLink fallback="/" phoneOnly />
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold lg:text-3xl">{tr('Lists')}</h1>
          <p className="mt-0.5 text-xs text-fog-500">{tr('Choose up to 3 lists for Home. Empty lists stay selected and appear when they have series.')}</p>
        </div>
        <button type="button" onClick={() => setImporting(true)} aria-haspopup="dialog" data-list-import className="chip text-xs">{tr('Import')}</button>
        <button type="button" onClick={() => setCreating(true)} aria-haspopup="dialog" className="btn-accent px-3.5 py-2 text-sm">
          <IcPlus width={16} height={16} aria-hidden />{tr('New list')}
        </button>
      </header>

      {isLoading ? (
        <div role="status" aria-busy="true" className="grid grid-cols-1 gap-3 px-4 pt-3 sm:grid-cols-2 lg:grid-cols-3 lg:px-0">
          <span className="sr-only">{tr('Loading…')}</span>
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
        </div>
      ) : false ? (
        <EmptyState art={ART.emptyLibrary} title={tr('No lists yet')}
          sub={tr('Group series into reading lists, like “Plan to read”. Create one, then add series from any series page.')}
          cta={undefined} />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 px-4 pt-3 sm:grid-cols-2 lg:grid-cols-3 lg:px-0">
            <li data-list-favorites className="card group relative overflow-hidden p-4">
              <span aria-hidden className="absolute inset-y-0 start-0 w-1.5 bg-rose-400" />
              <Link href="/collection/?id=favorites" className="block ps-2">
                <p className="flex items-center gap-2 font-display text-lg font-semibold text-fog-50"><IcHeart width={16} height={16} aria-hidden className="text-rose-400" />{tr('Favorites')}</p>
                <p className="text-xs text-fog-500">{favCount === 1 ? tr('1 series') : tr('{n} series', { n: favCount })}</p>
              </Link>
              <div className="mt-3 flex items-center gap-1.5 ps-2">
                <button type="button" onClick={() => void exportList('favorites', tr('Favorites'))} className="chip text-xs">{tr('Export')}</button>
              </div>
            </li>
          </ul>
          {/* v0.61.0: the reader's own lists, then those someone else shares with the household -- read-only here, and
              never theirs to delete. A section is named only when there are two. */}
          {theirs.length > 0 && <h2 className="px-4 pt-4 font-display text-base font-semibold text-fog-100 lg:px-0">{tr('Your lists')}</h2>}
          {mine.length > 0 && <div className="grid grid-cols-1 gap-3 px-4 pt-3 sm:grid-cols-2 lg:grid-cols-3 lg:px-0">{mine.map(card)}</div>}
          {theirs.length > 0 && (
            <>
              <h2 className="px-4 pt-6 font-display text-base font-semibold text-fog-100 lg:px-0">{tr('Shared with you')}</h2>
              <div className="grid grid-cols-1 gap-3 px-4 pt-3 sm:grid-cols-2 lg:grid-cols-3 lg:px-0">{theirs.map(card)}</div>
            </>
          )}
        </>
      )}

      {importing && <ImportListModal onClose={() => setImporting(false)} onDone={(id) => router.push(`/collection/?id=${id}`)} />}

      {creating && (
        <Modal title={tr('New list')} onClose={() => setCreating(false)}>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()}
            aria-label={tr('Name')} placeholder={tr('e.g. Plan to read')} autoComplete="off"
            className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm text-fog-50 outline-hidden focus-visible:outline-accent focus-visible:outline-offset-0 focus:border-accent" />
          <div className="mt-3 flex items-center gap-2" role="group" aria-label={tr('Color')}>
            {ACCENTS.map((a, i) => (
              <button key={a} type="button" onClick={() => setAccent(a)} aria-label={tr(ACCENT_NAMES[i])} aria-pressed={accent === a}
                className={`relative h-7 w-7 rounded-full transition before:absolute before:-inset-1 ${accent === a ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-ink-900' : ''}`}
                style={{ background: a }} />
            ))}
          </div>
          <button type="button" onClick={create} disabled={!name.trim()} className="btn-accent mt-4 w-full py-2.5 text-sm disabled:opacity-50">{tr('Create')}</button>
        </Modal>
      )}
    </div>
  );
}
