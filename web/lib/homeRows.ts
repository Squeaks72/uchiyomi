// Home's rows, in the order they ship and as one reader has rearranged them (`homeRows` in /api/settings).
// Default order: what you are doing, then what is new for you, then what you chose, then suggestions,
// then the library at large.
export const HOME_ROWS = ['continue', 'updates', 'favorites', 'because', 'rated', 'collections', 'added', 'top'] as const;
export type HomeRowId = (typeof HOME_ROWS)[number];

export interface HomeRowsSetting { order?: unknown; hidden?: unknown }

const known = (v: unknown): HomeRowId[] =>
  Array.isArray(v) ? v.filter((x): x is HomeRowId => (HOME_ROWS as readonly string[]).includes(x as string)) : [];

/** The saved order, with rows it does not mention (new ones, or never moved) after it in the default order. */
export function homeRowOrder(saved: HomeRowsSetting | null | undefined): HomeRowId[] {
  const first = [...new Set(known(saved?.order))];
  return [...first, ...HOME_ROWS.filter((r) => !first.includes(r))];
}

export function homeRowsHidden(saved: HomeRowsSetting | null | undefined): Set<HomeRowId> {
  return new Set(known(saved?.hidden));
}

export function isDefaultHomeRows(saved: HomeRowsSetting | null | undefined): boolean {
  return homeRowOrder(saved).every((r, i) => r === HOME_ROWS[i]) && homeRowsHidden(saved).size === 0;
}
