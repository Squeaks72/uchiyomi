// An extension's own search filters (Mihon's FilterList), between the engine's GraphQL shapes and ours (lib/sources/types.ts
// SourceFilter / FilterChange). Pure, so the shapes are tested without an engine.
import type { SourceFilter, FilterChange } from '../types';

const TRI = new Set(['IGNORE', 'INCLUDE', 'EXCLUDE']);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** What the engine answered for `source.filters`, as controls. Headers and separators are left out but still count in `pos`. */
export function filtersOf(raw: unknown): SourceFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: SourceFilter[] = [];
  raw.forEach((f: any, pos) => {
    const name = str(f?.name).trim();
    switch (f?.__typename) {
      case 'CheckBoxFilter': out.push({ kind: 'checkbox', pos, name, value: f.cbDefault === true }); break;
      case 'TriStateFilter': out.push({ kind: 'tri', pos, name, value: TRI.has(f.triDefault) ? f.triDefault : 'IGNORE' }); break;
      case 'TextFilter': out.push({ kind: 'text', pos, name, value: str(f.textDefault) }); break;
      case 'SelectFilter': out.push({ kind: 'select', pos, name, values: strs(f.values), value: Number.isInteger(f.selDefault) ? f.selDefault : 0 }); break;
      case 'SortFilter': out.push({ kind: 'sort', pos, name, values: strs(f.sortValues), value: { index: Number.isInteger(f.sortDefault?.index) ? f.sortDefault.index : 0, ascending: f.sortDefault?.ascending === true } }); break;
      case 'GroupFilter': {
        const inner = filtersOf(f.filters);
        if (inner.length) out.push({ kind: 'group', pos, name, filters: inner });
        break;
      }
      default: break; // header, separator
    }
  });
  return out;
}

/**
 * One change as the engine's FilterChangeInput. A group's child is a change of its own, wrapped as `groupChange` (the engine
 * takes one nested change per entry, not a list). Null for a path that names nothing it can say.
 */
export function toFilterChange(c: FilterChange): Record<string, unknown> | null {
  if (!Array.isArray(c.path) || !c.path.length || c.path.length > 2 || !c.path.every((n) => Number.isInteger(n) && n >= 0)) return null;
  const leaf: Record<string, unknown> = { position: c.path[c.path.length - 1] };
  if (typeof c.checkbox === 'boolean') leaf.checkBoxState = c.checkbox;
  else if (c.tri && TRI.has(c.tri)) leaf.triState = c.tri;
  else if (typeof c.text === 'string') leaf.textState = c.text.slice(0, 200);
  else if (Number.isInteger(c.select) && (c.select as number) >= 0) leaf.selectState = c.select;
  else if (c.sort && Number.isInteger(c.sort.index) && c.sort.index >= 0) leaf.sortState = { index: c.sort.index, ascending: c.sort.ascending === true };
  else return null;
  return c.path.length === 2 ? { position: c.path[0], groupChange: leaf } : leaf;
}
