'use client';
// The name filter and sort every source list shares (lib/sourceList.ts holds the rules). Controlled by the
// caller, so a list keeps its own state; `useSourceTools` is the one-line way to hold it.
import { useState } from 'react';
import { IcSearch, IcX } from '@/components/icons';
import { type SourceSort } from '@/lib/sourceList';
import { t as tr } from '@/lib/i18n';

export function useSourceTools() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SourceSort>('default');
  return { query, setQuery, sort, setSort };
}

export function SourceTools({ query, onQuery, sort, onSort, defaultLabel, sorts = ['default', 'az', 'za'], shown, total, className = '' }: {
  query: string;
  onQuery: (q: string) => void;
  sort: SourceSort;
  onSort: (s: SourceSort) => void;
  /** What `default` is called here: "Priority", "Most series". */
  defaultLabel: string;
  /** Which sorts this list offers; a list with no meaningful own order leaves `default` out. */
  sorts?: SourceSort[];
  /** Rows left after the filter, and rows before it: said only while a filter is cutting the list. */
  shown?: number;
  total?: number;
  className?: string;
}) {
  const label: Record<SourceSort, string> = { default: defaultLabel, az: tr('A–Z'), za: tr('Z–A') };
  return (
    <div className={className} data-source-tools>
      <div className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-1.5 focus-within:border-accent">
        <IcSearch aria-hidden width={16} height={16} className="text-fog-500" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={tr('Find a source by name')}
          aria-label={tr('Find a source by name')}
          autoComplete="off"
          autoCapitalize="none"
          enterKeyHint="search"
          data-no-autofocus
          className="w-full bg-transparent text-sm text-fog-50 outline-hidden placeholder:text-fog-500"
        />
        {query && (
          <button type="button" onClick={() => onQuery('')} className="text-fog-500" aria-label={tr('Clear')}>
            <IcX aria-hidden width={15} height={15} />
          </button>
        )}
      </div>
      {sorts.length > 1 && (
        <div role="group" aria-label={tr('Sort sources')} className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-fog-500">{tr('Sort')}</span>
          {sorts.map((s) => (
            <button key={s} type="button" onClick={() => onSort(s)} aria-pressed={sort === s}
              className={`chip py-0.5 text-[11px] ${sort === s ? 'chip-active' : ''}`}>{label[s]}</button>
          ))}
          {query.trim() && shown !== undefined && total !== undefined && (
            <span className="ms-auto text-[11px] tabular-nums text-fog-500">{shown}/{total}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** What to say when the filter matches nothing. */
export function NoSourceMatch({ query }: { query: string }) {
  return <p role="status" className="px-3 py-6 text-center text-sm text-fog-500">{tr('No source matches “{q}”.', { q: query.trim() })}</p>;
}
