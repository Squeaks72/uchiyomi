'use client';
// Discover → Tags → "A source's filters": a source's own search controls (genres, tags, status, sort...), as the extension
// declares them, then its results (bff POST /api/sources/browse). A tri-state tag cycles include → exclude → off.
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { SourceCard, type SourceItem } from '@/components/cards';

type Tri = 'IGNORE' | 'INCLUDE' | 'EXCLUDE';
type Control =
  | { kind: 'checkbox'; pos: number; name: string; value: boolean }
  | { kind: 'tri'; pos: number; name: string; value: Tri }
  | { kind: 'text'; pos: number; name: string; value: string }
  | { kind: 'select'; pos: number; name: string; values: string[]; value: number }
  | { kind: 'sort'; pos: number; name: string; values: string[]; value: { index: number; ascending: boolean } }
  | { kind: 'group'; pos: number; name: string; filters: Control[] };
interface Change { path: number[]; checkbox?: boolean; tri?: Tri; text?: string; select?: number; sort?: { index: number; ascending: boolean } }
interface Src { id: string; name: string; lang: string | null }

const GRID = 'grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 lg:gap-x-4 xl:grid-cols-8';
const keyOf = (path: number[]) => path.join('.');
const NEXT: Record<Tri, Tri> = { IGNORE: 'INCLUDE', INCLUDE: 'EXCLUDE', EXCLUDE: 'IGNORE' };
/** The groups worth showing open: the ones that say what a series is about. */
const ABOUT = /genre|tag|theme|content|format|categor|demograph/i;

/** Every control with its path, one level of groups deep. */
function flat(cs: Control[], parent: number[] = []): Array<{ path: number[]; c: Control }> {
  return cs.flatMap((c) => (c.kind === 'group' ? flat(c.filters, [...parent, c.pos]) : [{ path: [...parent, c.pos], c }]));
}

export function SourceFilters({ sources, onOpen }: { sources: Src[]; onOpen: (it: SourceItem) => void }) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, Change>>({});
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState<{ q: string; changes: Change[] } | null>(null);

  useEffect(() => { setValues({}); setSubmitted(null); }, [sourceId]);

  const spec = useQuery({
    queryKey: ['source-filters', sourceId], enabled: !!sourceId, staleTime: 10 * 60_000, retry: 1,
    queryFn: () => api<{ filters: Control[] }>(`/api/sources/filters?source=${encodeURIComponent(sourceId)}`),
  });
  const controls = spec.data?.filters ?? [];
  const byPath = useMemo(() => new Map(flat(controls).map((x) => [keyOf(x.path), x.c])), [controls]);

  const change = (path: number[], patch: Partial<Change>) => setValues((v) => ({ ...v, [keyOf(path)]: { path, ...patch } }));
  const triOf = (path: number[], c: Extract<Control, { kind: 'tri' }>): Tri => values[keyOf(path)]?.tri ?? c.value;
  const boxOf = (path: number[], c: Extract<Control, { kind: 'checkbox' }>) => values[keyOf(path)]?.checkbox ?? c.value;

  // What the reader moved from the extension's own starting point; the rest is left as the extension has it.
  const changes = useMemo(() => Object.values(values).filter((ch) => {
    const c = byPath.get(keyOf(ch.path));
    if (!c) return false;
    if (c.kind === 'tri') return ch.tri !== undefined && ch.tri !== c.value;
    if (c.kind === 'checkbox') return ch.checkbox !== undefined && ch.checkbox !== c.value;
    if (c.kind === 'select') return ch.select !== undefined && ch.select !== c.value;
    if (c.kind === 'text') return ch.text !== undefined && ch.text !== c.value;
    if (c.kind === 'sort') return !!ch.sort && (ch.sort.index !== c.value.index || ch.sort.ascending !== c.value.ascending);
    return false;
  }), [values, byPath]);

  const results = useInfiniteQuery({
    queryKey: ['source-browse', sourceId, submitted],
    enabled: !!submitted && !!sourceId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<{ content: SourceItem[] }>('/api/sources/browse', { method: 'POST', json: { source: sourceId, q: submitted!.q, page: pageParam, changes: submitted!.changes } }),
    getNextPageParam: (last, all) => (last.content.length ? all.length + 1 : undefined),
    staleTime: 5 * 60_000,
  });
  const seen = new Set<string>();
  const items = (results.data?.pages.flatMap((p) => p.content) ?? []).filter((it) => { const k = `${it.source}:${it.sourceId}`; if (seen.has(k)) return false; seen.add(k); return true; });

  const renderControl = (c: Control, path: number[]) => {
    const id = `sf-${sourceId}-${keyOf(path)}`;
    switch (c.kind) {
      case 'tri': {
        const st = triOf(path, c);
        return (
          <button key={id} type="button" onClick={() => change(path, { tri: NEXT[st] })} aria-pressed={st !== 'IGNORE'}
            className={`chip text-xs ${st === 'INCLUDE' ? 'border-accent/60 text-fog-50' : st === 'EXCLUDE' ? 'border-rose-500/60 text-rose-300' : ''}`}>
            {st === 'EXCLUDE' ? '− ' : ''}{c.name}
          </button>
        );
      }
      case 'checkbox': {
        const on = boxOf(path, c);
        return <button key={id} type="button" onClick={() => change(path, { checkbox: !on })} aria-pressed={on} className={`chip text-xs ${on ? 'border-accent/60 text-fog-50' : ''}`}>{c.name}</button>;
      }
      case 'select':
        return (
          <label key={id} className="flex items-center gap-2 text-xs text-fog-400">{c.name}
            <select value={values[keyOf(path)]?.select ?? c.value} onChange={(e) => change(path, { select: Number(e.target.value) })} className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-fog-200">
              {c.values.map((v, i) => <option key={i} value={i}>{v}</option>)}
            </select>
          </label>
        );
      case 'text':
        return (
          <label key={id} className="flex items-center gap-2 text-xs text-fog-400">{c.name}
            <input value={values[keyOf(path)]?.text ?? c.value} onChange={(e) => change(path, { text: e.target.value })} className="w-40 rounded border border-ink-700 bg-transparent px-2 py-1 text-xs text-fog-100" />
          </label>
        );
      case 'sort': {
        const cur = values[keyOf(path)]?.sort ?? c.value;
        return (
          <span key={id} className="flex items-center gap-2 text-xs text-fog-400">{c.name}
            <select value={cur.index} onChange={(e) => change(path, { sort: { index: Number(e.target.value), ascending: cur.ascending } })} className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-fog-200">
              {c.values.map((v, i) => <option key={i} value={i}>{v}</option>)}
            </select>
            <button type="button" className="chip text-xs" onClick={() => change(path, { sort: { index: cur.index, ascending: !cur.ascending } })}>{cur.ascending ? tr('Ascending') : tr('Descending')}</button>
          </span>
        );
      }
      default: return null;
    }
  };

  const go = () => setSubmitted({ q: query.trim(), changes });
  const loose = controls.filter((c) => c.kind !== 'group');
  const groups = controls.filter((c): c is Extract<Control, { kind: 'group' }> => c.kind === 'group');

  return (
    <div className="space-y-3" data-source-filters>
      <label className="flex flex-wrap items-center gap-2 text-xs text-fog-400">{tr('Source')}
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label={tr('Source')} className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-fog-100">
          {sources.map((s) => <option key={s.id} value={s.id}>{s.name}{s.lang ? ` (${s.lang})` : ''}</option>)}
        </select>
      </label>
      {spec.isLoading && <div role="status" className="text-sm text-fog-500">{tr('Reading the source’s filters…')}</div>}
      {spec.isError && <p className="text-xs text-amber-300">{tr('This source could not say what it can filter by.')}</p>}
      {!spec.isLoading && !spec.isError && !controls.length && <p className="text-xs text-fog-500">{tr('This source has no filters of its own.')}</p>}
      {groups.map((g) => (
        <details key={g.pos} open={ABOUT.test(g.name)} className="rounded border border-ink-800 px-3 py-2">
          <summary className="cursor-pointer text-sm text-fog-200">{g.name}</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">{g.filters.map((c) => renderControl(c, [g.pos, c.pos]))}</div>
        </details>
      ))}
      {loose.length > 0 && <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{loose.map((c) => renderControl(c, [c.pos]))}</div>}
      {controls.length > 0 && (
        <form onSubmit={(e) => { e.preventDefault(); go(); }} className="flex flex-wrap items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Words in the title (optional)')} aria-label={tr('Words in the title (optional)')}
            className="min-w-0 flex-1 rounded border border-ink-700 bg-transparent px-3 py-2 text-sm text-fog-100" />
          <button type="submit" className="btn-accent px-5 py-2 text-sm">{changes.length ? tr('Search with filters ({n})', { n: changes.length }) : tr('Browse')}</button>
        </form>
      )}
      {submitted && (results.isLoading ? (
        <div role="status" className="py-6 text-center text-sm text-fog-500">{tr('Asking the source…')}</div>
      ) : results.isError ? (
        <p className="py-4 text-center text-sm text-amber-300">{tr('The source could not answer that.')}</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-fog-500">{tr('Nothing matched those filters on this source.')}</p>
      ) : (
        <>
          <div className={GRID}>
            {items.map((it, i) => <SourceCard key={`${it.source}:${it.sourceId}`} item={it} onAdd={() => onOpen(it)} eager={i < 12} />)}
          </div>
          {results.hasNextPage && (
            <div className="text-center">
              <button type="button" className="btn-ghost px-5 py-2 text-sm" disabled={results.isFetchingNextPage} onClick={() => results.fetchNextPage()}>
                {results.isFetchingNextPage ? tr('Loading…') : tr('Show more')}
              </button>
            </div>
          )}
        </>
      ))}
    </div>
  );
}
