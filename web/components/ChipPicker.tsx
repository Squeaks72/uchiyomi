'use client';
// A long list of choices, as chips, without the wall.
//
// The 18+ genre list had 200+ chips on one page, the chapter filter one per translation group, a source list one per
// flagged source. A list that long is not something anyone scans: it is a search. So the SELECTED ones are always shown
// (they are the state, and a filter must never be on out of sight) and the rest are behind a search box: type, and the
// unselected matches appear as chips to tap. Focusing the box with nothing typed offers the first few, so it is still
// browsable. Pure presentation: the caller owns the selection and how a tap is saved.
import React, { useId, useMemo, useState, type ReactNode } from 'react';
import { t as tr } from '@/lib/i18n';

export interface ChipOption {
  key: string;
  label: string;
  /** Drawn before the label (a group's avatar). */
  icon?: ReactNode;
}

/** Folded for matching: case, accents and spacing never stand between a person and the chip. */
const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** The unselected options that match `query`, in the list's own order. Pure, so a test can hold it. */
export function pickable(options: readonly ChipOption[], selected: ReadonlySet<string>, query: string): ChipOption[] {
  const q = fold(query);
  return options.filter((o) => !selected.has(o.key) && (!q || fold(o.label).includes(q) || fold(o.key).includes(q)));
}

export function ChipPicker({ options, selected, onToggle, label, placeholder, limit = 24, disabled, single, allLabel, onAll, chipClass = 'text-xs' }: {
  options: readonly ChipOption[];
  /** The chosen keys. Always drawn, whether or not they are in `options` (a stored value the list no longer has). */
  selected: readonly string[];
  /** A chip was tapped: a chosen one to take off, or one found by search to put on. */
  onToggle: (key: string) => void;
  /** What the list is, for the search box and the group's name ("Genres"). */
  label: string;
  placeholder?: string;
  /** The most matches drawn at once. */
  limit?: number;
  disabled?: boolean;
  /** One choice at a time: choosing another replaces it, and `allLabel`'s chip (when given) clears it through `onAll`. */
  single?: boolean;
  allLabel?: string;
  onAll?: () => void;
  chipClass?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);
  const found = useMemo(() => pickable(options, chosen, query), [options, chosen, query]);
  const shown = found.slice(0, limit);
  const showList = open || query.trim() !== '';
  const none = single && selected.length === 0;
  return (
    <div data-chip-picker role="group" aria-label={label}>
      <div className="flex flex-wrap items-center gap-1.5" data-chip-picker-selected>
        {single && allLabel && (
          <button type="button" disabled={disabled} onClick={onAll} aria-pressed={none} className={`chip ${chipClass} ${none ? 'chip-active' : ''}`}>{allLabel}</button>
        )}
        {selected.map((k) => {
          const o = byKey.get(k);
          return (
            <button key={k} type="button" disabled={disabled} onClick={() => onToggle(k)} aria-pressed
              aria-label={tr('Remove {name}', { name: o?.label ?? k })} className={`chip chip-active ${chipClass}`}>
              {o?.icon}<span className="max-w-[14rem] truncate">{o?.label ?? k}</span><span aria-hidden> ×</span>
            </button>
          );
        })}
      </div>
      {options.length > 0 && (
        <div className="mt-2">
          <input id={id} type="search" value={query} disabled={disabled} placeholder={placeholder ?? tr('Search {n}…', { n: options.length })}
            aria-label={tr('Search: {name}', { name: label })} autoComplete="off" data-no-autofocus
            onChange={(e) => setQuery(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onToggle(shown[0].key); setQuery(''); }
              else if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); }
            }}
            className="field w-full max-w-xs" />
          {showList && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-chip-picker-results>
              {shown.map((o) => (
                <button key={o.key} type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => { onToggle(o.key); }} aria-pressed={false}
                  className={`chip ${chipClass}`}>
                  {o.icon}<span className="max-w-[14rem] truncate">{o.label}</span>
                </button>
              ))}
              {!shown.length && <span className="text-[11px] text-fog-500">{tr('No matches.')}</span>}
              {found.length > shown.length && (
                <span className="self-center text-[11px] text-fog-500">{tr('{n} more — keep typing to narrow them.', { n: found.length - shown.length })}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
