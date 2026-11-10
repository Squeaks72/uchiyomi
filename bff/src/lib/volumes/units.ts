// Volumes and arcs as units of chapters (fork): what the series page groups by and what "a whole volume is here"
// announces. Pure -- no database -- so volumesUnits.test.ts reaches every rule here.
//
// A unit is a label and the chapter numbers it collects. Volumes come from Wikipedia (wikiParse.ts), from the volume
// tags in the sources' own chapter names ("Vol.3 Ch.25"), or from the admin's text; arcs only from the admin's text,
// because no source publishes them in a form that can be read.

export type UnitKind = 'volume' | 'arc';

export interface Unit {
  kind: UnitKind;
  /** "14" for a volume (shown as "Volume 14"), the arc's own name for an arc. */
  label: string;
  /** Ascending. Whole and half chapters alike; only the whole ones decide whether the unit is complete. */
  chapters: number[];
  /** YYYY-MM-DD, the original release, when known. */
  released: string | null;
}

/** The most chapters one admin line may name: "1-100000" is a typo, not an arc. */
export const MAX_UNIT_CHAPTERS = 2000;
/** The most lines the admin's text may hold. */
export const MAX_MANUAL_LINES = 500;

const LINE = /^\s*(vol(?:ume)?\.?|arc)\b\s*(.*)$/i;
const RANGE = /^\s*(\d{1,5}(?:\.\d{1,2})?)\s*(?:[-–—]|to)\s*(\d{1,5}(?:\.\d{1,2})?)\s*$|^\s*(\d{1,5}(?:\.\d{1,2})?)\s*$/i;

export interface ManualParse { units: Unit[]; errors: number[] }

/**
 * The admin's text, one unit per line:
 *
 *     Volume 1: 1-7
 *     Vol 2: 8-16, 16.5
 *     Arc Romance Dawn: 1-7
 *     Arc: Orange Town: 8-21
 *
 * The label runs to the LAST colon, so an arc may have a colon in its name. `#` starts a comment. A line that does not
 * read is reported by its (1-based) number and left out; nothing else is guessed.
 */
export function parseManual(text: string | null | undefined): ManualParse {
  const units: Unit[] = [];
  const errors: number[] = [];
  if (!text) return { units, errors };
  const lines = text.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_MANUAL_LINES);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const m = LINE.exec(line);
    const colon = line.lastIndexOf(':');
    if (!m || colon < 0) { errors.push(i + 1); return; }
    const kind: UnitKind = m[1].toLowerCase() === 'arc' ? 'arc' : 'volume';
    const head = line.slice(m[1].length, colon).replace(/^\s*[:.\-–—]?\s*/, '').trim();
    const label = kind === 'volume' ? head.replace(/^0+(?=\d)/, '') : head;
    if (!label || label.length > 120) { errors.push(i + 1); return; }
    const chapters: number[] = [];
    let ok = true;
    for (const part of line.slice(colon + 1).split(',')) {
      const r = RANGE.exec(part);
      if (!r) { ok = false; break; }
      if (r[3] !== undefined) { chapters.push(Number(r[3])); continue; }
      const a = Number(r[1]);
      const b = Number(r[2]);
      if (b < a || b - a > MAX_UNIT_CHAPTERS) { ok = false; break; }
      // A range is its whole chapters, and its ends as written (a range may start or end on a half chapter).
      chapters.push(a);
      for (let n = Math.floor(a) + 1; n < b; n++) chapters.push(n);
      if (b !== a) chapters.push(b);
    }
    if (!ok || !chapters.length || chapters.length > MAX_UNIT_CHAPTERS) { errors.push(i + 1); return; }
    units.push({ kind, label, chapters: [...new Set(chapters)].sort((x, y) => x - y), released: null });
  });
  return { units, errors };
}

/** A unit's chapters as the shortest text: "1-7", "8-15, 15.5, 16". */
export function rangesText(chapters: readonly number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < chapters.length) {
    const a = chapters[i];
    let j = i;
    while (j + 1 < chapters.length && Number.isInteger(chapters[j]) && chapters[j + 1] === chapters[j] + 1) j++;
    out.push(j > i ? `${a}-${chapters[j]}` : String(a));
    i = j + 1;
  }
  return out.join(', ');
}

/** The units as the admin's text, to start an edit from what is shown now. */
export function toManual(units: readonly Unit[]): string {
  return units.map((u) => `${u.kind === 'arc' ? 'Arc' : 'Volume'} ${u.label}: ${rangesText(u.chapters)}`).join('\n');
}

// "Vol.3 Ch.25", "Volume 3 Chapter 25", "Vol. 03 - Chapter 25", "v3 c25", "Tome 3".
const VOLUME_TAG = /(?:^|[^\p{L}])(?:vol(?:ume)?|tome|band)\.?\s*(\d{1,4}(?:\.\d)?)(?!\d)|(?:^|[\s_\-[(])v(\d{1,3})(?=[\s._\-]*(?:c|ch|chapter)\s*\.?\s*\d)/iu;

/** The volume a chapter's name says it is in, or null. */
export function volumeTagOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = VOLUME_TAG.exec(name);
  if (!m) return null;
  const v = (m[1] ?? m[2]).replace(/^0+(?=\d)/, '');
  return v;
}

/**
 * Volumes read from the sources' chapter names: every chapter whose name carries a volume tag, grouped by it. Taken
 * only when it reads as a volume list -- at least three tagged chapters, and each volume's chapters after the one
 * before's (a source that tags "Vol.1" on every chapter, or tags at random, gives no volumes rather than wrong ones).
 */
export function volumesFromNames(chapters: ReadonlyArray<{ number: number; name: string | null }>): Unit[] {
  const by = new Map<string, Set<number>>();
  let tagged = 0;
  for (const c of chapters) {
    if (!Number.isFinite(c.number)) continue;
    const v = volumeTagOf(c.name);
    if (v === null) continue;
    tagged++;
    if (!by.has(v)) by.set(v, new Set());
    by.get(v)!.add(c.number);
  }
  if (tagged < 3 || by.size < 1) return [];
  const units: Unit[] = [...by.entries()]
    .map(([label, set]) => ({ kind: 'volume' as const, label, chapters: [...set].sort((a, b) => a - b), released: null }))
    .sort((a, b) => Number(a.label) - Number(b.label) || a.chapters[0] - b.chapters[0]);
  // One volume holding every tagged chapter of a long series is a source stamping "Vol.1" on everything.
  if (units.length === 1 && units[0].chapters.length > 30) return [];
  let prevEnd = -Infinity;
  let bad = 0;
  for (const u of units) {
    const whole = u.chapters.filter(Number.isInteger);
    if (!whole.length) continue;
    if (whole[0] <= prevEnd) bad++;
    prevEnd = Math.max(prevEnd, whole[whole.length - 1]);
  }
  return bad > Math.floor(units.length * 0.1) ? [] : units;
}

/** The chapters that decide whether a unit is complete: the whole ones. A unit of extras alone never completes. */
export const required = (u: Pick<Unit, 'chapters'>): number[] => u.chapters.filter((n) => Number.isInteger(n));

/** Whether every whole chapter of the unit is held. */
export function isComplete(u: Pick<Unit, 'chapters'>, held: ReadonlySet<number>): boolean {
  const need = required(u);
  return need.length > 0 && need.every((n) => held.has(n));
}

/** A stable key for "this unit was already announced": kind and label, never the chapters, which a page may correct. */
export const unitKey = (u: Pick<Unit, 'kind' | 'label'>): string => `${u.kind}:${u.label}`;

/** "Volume 14" / the arc's name. */
export const unitName = (u: Pick<Unit, 'kind' | 'label'>): string => (u.kind === 'volume' ? `Volume ${u.label}` : u.label);

/** "Volume 14 (chapters 128–133)". */
export function unitSentence(u: Pick<Unit, 'kind' | 'label' | 'chapters'>): string {
  const need = required(u);
  const span = need.length ? (need.length === 1 ? `chapter ${need[0]}` : `chapters ${need[0]}–${need[need.length - 1]}`) : '';
  return span ? `${unitName(u)} (${span})` : unitName(u);
}
