'use client';
/**
 * "Fetch names": better chapter names from the sources that have them, chosen and checked by a person.
 *
 * Step 1 asks the server which sources carry this work AND number it the same way (the donor judgement of bff lib/borrowNames.ts: its
 * title is ours, its numbering lines up both ways, its language is the series'). That is ANY enabled source, not only the ones the
 * series follows -- which is why the dialog says who was asked. Step 2 is a preview: one line per chapter, the name it has now beside
 * the name offered, each with its own tick. Chapters that already have a real name stay as they are unless "Replace names I already
 * have" is on; nothing is written until Apply, and what is written is kept (the chapter's own source does not undo it later).
 *
 * `scope` is the chapters the person selected on the series page, or null for the whole series.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Modal, msgOf } from '@/components/ConfirmDialog';
import { chapterLabel, chapterName } from '@/lib/format';
import { t as tr } from '@/lib/i18n';
import type { Book, Ghost } from '@/lib/types';

interface Offer { source: string; sourceId: string; label: string; names: Array<[number, string]> }
interface Search {
  offers: Offer[]; asked: Array<{ id: string; name: string }>; why?: string;
  available?: Array<{ id: string; name: string }>;
  rejected?: Array<{ id: string; name: string; why: string }>;
}
interface Item { number: number; current: string; listedOnly: boolean }

const GENERIC = /^(ch(apter)?\.?\s*)?[\d.]+$/i;
/** A name that says no more than the number does is not one worth keeping over a real name. */
const isGeneric = (s: string) => !s.trim() || GENERIC.test(s.trim());

export function ChapterNamesDialog({ seriesId, books, ghosts, scope, onClose, onApplied }: {
  seriesId: string; books: Book[]; ghosts: Ghost[]; scope: number[] | null; onClose: () => void; onApplied: (n: number) => void;
}) {
  const [search, setSearch] = useState<Search | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState(0);
  const [replace, setReplace] = useState(false);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  // Other sources the person ticked to ask by name, what is being asked, and the ones that turned out not to match (with why).
  const [more, setMore] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [declined, setDeclined] = useState<Array<{ id: string; name: string; why: string }>>([]);

  useEffect(() => {
    let dead = false;
    api<Search>(`/api/admin/series/${encodeURIComponent(seriesId)}/names/search`, { method: 'POST', json: {} })
      .then((r) => { if (!dead) setSearch(r); })
      .catch((e) => { if (!dead) setError(msgOf(e, tr('Could not search for chapter names'))); });
    return () => { dead = true; };
  }, [seriesId]);

  // The chapters this is about: those on the server, and those only listed, in the scope chosen. A range file is not one chapter.
  const items = useMemo<Item[]>(() => {
    const keep = scope ? new Set(scope) : null;
    const out = new Map<number, Item>();
    for (const b of books) {
      if (b.pruned || b.numberEnd != null || (keep && !keep.has(b.number))) continue;
      out.set(b.number, { number: b.number, current: chapterName(b), listedOnly: false });
    }
    for (const g of ghosts) {
      if (g.numberEnd != null || out.has(g.number) || (keep && !keep.has(g.number))) continue;
      out.set(g.number, { number: g.number, current: (g.title ?? '').trim(), listedOnly: true });
    }
    return [...out.values()].sort((a, b) => b.number - a.number);
  }, [books, ghosts, scope]);

  const askMore = async () => {
    if (!more.size || asking) return;
    setAsking(true);
    const ids = [...more];
    try {
      const r = await api<Search>(`/api/admin/series/${encodeURIComponent(seriesId)}/names/search`, { method: 'POST', json: { sources: ids } });
      setSearch((prev) => {
        if (!prev) return prev;
        const fresh = r.offers.filter((o) => !prev.offers.some((p) => p.source === o.source));
        if (fresh.length) setPick(prev.offers.length);
        return { ...prev, offers: [...prev.offers, ...fresh], available: (prev.available ?? []).filter((a) => !ids.includes(a.id)), why: undefined };
      });
      setDeclined((d) => [...d, ...(r.rejected ?? [])]);
      setMore(new Set());
    } catch (e) { setError(msgOf(e, tr('Could not search for chapter names'))); }
    finally { setAsking(false); }
  };
  const declinedWhy = (w: string) => (w === 'title_differs' ? tr('has a different title') : w === 'numbering_differs' ? tr('numbers the chapters differently')
    : w === 'not_found' ? tr('does not have this series') : w === 'unreachable' ? tr('did not answer') : tr('not a match'));

  const offer = search?.offers[pick];
  const byNumber = useMemo(() => new Map(offer?.names ?? []), [offer]);
  const rows = useMemo(() => {
    const out: Array<Item & { proposed: string }> = [];
    let kept = 0;
    for (const it of items) {
      const proposed = byNumber.get(it.number);
      if (!proposed || proposed === it.current) continue;
      if (!isGeneric(it.current) && !replace) { kept++; continue; }
      out.push({ ...it, proposed });
    }
    return { list: out, kept };
  }, [items, byNumber, replace]);
  useEffect(() => { setOff(new Set()); }, [pick, replace]);

  const chosen = rows.list.filter((r) => !off.has(r.number));
  const toggle = (n: number) => setOff((o) => { const x = new Set(o); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const apply = async () => {
    if (!offer || !chosen.length || saving) return;
    setSaving(true);
    try {
      await api(`/api/admin/series/${encodeURIComponent(seriesId)}/names/apply`, { method: 'POST', json: { source: offer.source, names: chosen.map((r) => ({ number: r.number, name: r.proposed })) } });
      onApplied(chosen.length);
      onClose();
    } catch (e) { setError(msgOf(e, tr('Could not save the chapter names'))); setSaving(false); }
  };

  const scopeText = scope ? (scope.length === 1 ? tr('1 selected chapter') : tr('{n} selected chapters', { n: scope.length })) : tr('Every chapter');
  return (
    <Modal title={tr('Fetch chapter names')} onClose={onClose} wide fieldFocus={false}>
      <div data-names-dialog className="space-y-3 text-sm">
        <p className="text-xs text-fog-500">{scopeText} · {items.length === 1 ? tr('1 chapter') : tr('{n} chapters', { n: items.length })}</p>
        {error && <p role="alert" className="text-rose-300">{error}</p>}
        {!search && !error && <p role="status" className="text-fog-400">{tr('Asking other sources which of them carry this series… this can take up to a minute.')}</p>}
        {search && search.offers.length === 0 && (
          <div data-names-none className="space-y-1.5 text-fog-300">
            <p>{search.why === 'posting_order' ? tr('This series is numbered by posting order, so another source cannot name its chapters')
              : search.why === 'too_few' ? tr('Too few chapters to match another source safely')
              : tr('No source carries this series with matching numbering.')}</p>
            {search.asked.length > 0 && <p className="text-xs text-fog-500">{tr('Asked: {names}', { names: search.asked.map((a) => a.name).join(', ') })}</p>}
          </div>
        )}
        {search && search.offers.length > 0 && (
          <>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs text-fog-500">{tr('Names from')}</legend>
              {search.offers.map((o, i) => {
                const have = o.names.filter(([n]) => items.some((it) => it.number === n)).length;
                return (
                  <label key={o.source} className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 has-[:checked]:border-accent">
                    <input type="radio" name="names-donor" checked={pick === i} onChange={() => setPick(i)} className="accent-[rgb(var(--accent))]" />
                    <span className="me-auto font-medium text-fog-100">{o.label}</span>
                    <span className="text-xs text-fog-500">{have === 1 ? tr('names for 1 chapter') : tr('names for {n} chapters', { n: have })}</span>
                  </label>
                );
              })}
              <p className="text-xs text-fog-500">{tr('These sources carry this series with the same numbering; they need not be ones it follows.')}</p>
            </fieldset>
            <label className="flex items-center gap-2 text-fog-200">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-[rgb(var(--accent))]" />
              {tr('Replace names I already have')}
            </label>
            {rows.list.length === 0 ? (
              <p data-names-nothing className="text-fog-400">{rows.kept > 0
                ? tr('Nothing to change: these chapters already have names. Turn on “Replace names I already have” to compare them.')
                : tr('{source} has no names for these chapters', { source: offer?.label ?? '' })}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="me-auto text-fog-400">{chosen.length === 1 ? tr('1 name will be saved') : tr('{n} names will be saved', { n: chosen.length })}{rows.kept > 0 && !replace ? ` · ${tr('{n} already named, left alone', { n: rows.kept })}` : ''}</span>
                  <button type="button" className="btn-key" onClick={() => setOff(new Set())}>{tr('Select all')}</button>
                  <button type="button" className="btn-key" onClick={() => setOff(new Set(rows.list.map((r) => r.number)))}>{tr('Select none')}</button>
                </div>
                <ul data-names-preview data-lenis-prevent className="max-h-[45vh] divide-y divide-ink-800/70 overflow-y-auto rounded-lg border border-ink-700">
                  {rows.list.map((r) => (
                    <li key={r.number}>
                      <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2">
                        <input type="checkbox" checked={!off.has(r.number)} onChange={() => toggle(r.number)} className="mt-1 accent-[rgb(var(--accent))]" />
                        <span className="w-16 shrink-0 text-fog-400">{chapterLabel({ number: r.number })}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-fog-100">{r.proposed}</span>
                          <span className="block break-words text-xs text-fog-500">
                            {r.current ? `${tr('Now')}: ${r.current}` : tr('No name yet')}{r.listedOnly ? ` · ${tr('not downloaded')}` : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {search && (search.available?.length ?? 0) > 0 && (
          <details data-names-more open={search.offers.length === 0} className="rounded-lg border border-ink-700 px-3 py-2">
            <summary className="cursor-pointer text-fog-200">{tr('Ask other sources')}</summary>
            <p className="mt-1 text-xs text-fog-500">{tr('Tick sources to ask whether they carry this series. Each is checked for a matching title and numbering before its names are offered.')}</p>
            <ul data-lenis-prevent className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {search.available!.map((a) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-fog-200">
                    <input type="checkbox" checked={more.has(a.id)} className="accent-[rgb(var(--accent))]"
                      onChange={() => setMore((m) => { const x = new Set(m); if (x.has(a.id)) x.delete(a.id); else x.add(a.id); return x; })} />
                    {a.name}
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void askMore()} disabled={!more.size || asking} data-names-ask className="btn-key mt-2">
              {asking ? '…' : more.size === 1 ? tr('Ask 1 source') : tr('Ask {n} sources', { n: more.size })}
            </button>
          </details>
        )}
        {declined.length > 0 && (
          <ul data-names-declined className="space-y-0.5 text-xs text-fog-500">
            {declined.map((d) => <li key={d.id}>{d.name} — {declinedWhy(d.why)}</li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-key">{tr('Cancel')}</button>
          {offer && rows.list.length > 0 && (
            <button type="button" onClick={() => void apply()} disabled={!chosen.length || saving} data-names-apply className="btn-key btn-key-accent">
              {saving ? '…' : chosen.length === 1 ? tr('Save 1 name') : tr('Save {n} names', { n: chosen.length })}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
