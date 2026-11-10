// The series page's Volumes view (fork, bff lib/volumes): the chapters grouped into the volumes (or arcs) that collect
// them, each with how much of it is here and how much is read. Pure, so volumes.test.ts reaches it.
//
// A chapter belongs to the unit whose span (its first to its last chapter) holds its number -- so a half chapter the
// volume list never names (12.5) still sits in its volume. Chapters past the last volume are "not in a volume yet";
// any other chapter no unit holds (a gap in the list) is listed under "Other chapters".
//
// The view is per series and per device, like the chapter layout (lib/chapterView.ts): a reader binges one series by
// the volume and follows another chapter by chapter.

export interface VolumeUnit {
  kind: 'volume' | 'arc';
  label: string;
  chapters: number[];
  released: string | null;
}

export interface SeriesVolumes {
  source: 'wikipedia' | 'names' | 'manual' | 'none';
  page: string | null;
  volumes: VolumeUnit[];
  arcs: VolumeUnit[];
  manual: string | null;
  checkedAt: string | null;
  waiting: boolean;
}

/** What a unit needs of a chapter row. */
export interface UnitBook { id: string; number: number; numberEnd?: number | null; readProgress?: { completed: boolean; page?: number } | null; pruned?: boolean }

export interface UnitView<B extends UnitBook = UnitBook> {
  /** null for the two catch-all groups. */
  unit: VolumeUnit | null;
  /** 'unit', or one of the catch-alls. */
  group: 'unit' | 'tail' | 'other';
  books: B[];
  /** The whole chapters the unit names. */
  need: number[];
  /** Of `need`, how many are here. */
  have: number;
  /** Of the books here, how many are read. */
  read: number;
  complete: boolean;
  /** The chapter to open: the first one here that is not read, else the first. Null with nothing here. */
  next: B | null;
}

const lastOf = (b: UnitBook) => (b.numberEnd != null && b.numberEnd > b.number ? b.numberEnd : b.number);

/** Every whole number a book covers: 12 for chapter 12, 1 to 7 for a `01-07` file. */
function covered(b: UnitBook): number[] {
  const out: number[] = [];
  if (Number.isInteger(b.number)) out.push(b.number);
  for (let n = Math.floor(b.number) + 1; n <= Math.floor(lastOf(b)); n++) out.push(n);
  return out;
}

export function groupByUnits<B extends UnitBook>(units: readonly VolumeUnit[], books: readonly B[]): UnitView<B>[] {
  const spans = units.map((u) => {
    const whole = u.chapters.filter(Number.isInteger);
    const lo = u.chapters.length ? Math.min(...u.chapters) : Infinity;
    const hi = u.chapters.length ? Math.max(...u.chapters) : -Infinity;
    return { u, need: whole, lo, hi };
  });
  const lastEnd = spans.reduce((m, s) => Math.max(m, s.hi), -Infinity);
  const sorted = [...books].sort((a, b) => a.number - b.number);
  const byUnit = spans.map(() => [] as B[]);
  const tail: B[] = [];
  const other: B[] = [];
  for (const b of sorted) {
    // Floor: 12.5 sits with 12. An arc list may overlap; a chapter is listed under every unit that holds it.
    const n = Math.floor(b.number);
    let placed = false;
    spans.forEach((s, i) => {
      if (n >= Math.floor(s.lo) && n <= s.hi) { byUnit[i].push(b); placed = true; }
    });
    if (!placed) (b.number > lastEnd ? tail : other).push(b);
  }
  const view = (unit: VolumeUnit | null, group: UnitView['group'], list: B[], need: number[]): UnitView<B> => {
    const here = new Set(list.flatMap(covered));
    const have = need.filter((n) => here.has(n)).length;
    const read = list.filter((b) => b.readProgress?.completed).length;
    const openable = list.filter((b) => !b.pruned);
    const next = openable.find((b) => !b.readProgress?.completed) ?? openable[0] ?? null;
    return { unit, group, books: list, need, have, read, complete: need.length > 0 && have === need.length, next };
  };
  const out = spans.map((s, i) => view(s.u, 'unit', byUnit[i], s.need));
  if (tail.length) out.push(view(null, 'tail', tail, []));
  if (other.length) out.push(view(null, 'other', other, []));
  return out;
}

/** "128–133", "7", "" -- the unit's whole chapters as one span. */
export function spanText(need: readonly number[]): string {
  if (!need.length) return '';
  return need.length === 1 ? String(need[0]) : `${need[0]}–${need[need.length - 1]}`;
}

const KEY = (seriesId: string) => `uchiyomi.volumeView.${seriesId}`;

/** This device's choice for this series: true = Volumes, false = chapters, null = never chosen. */
export function volumeViewOn(seriesId: string): boolean | null {
  try {
    const v = localStorage.getItem(KEY(seriesId));
    return v === '1' ? true : v === '0' ? false : null;
  } catch { return null; }
}
export function setVolumeView(seriesId: string, on: boolean): void {
  try { localStorage.setItem(KEY(seriesId), on ? '1' : '0'); } catch { /* a private window */ }
}
