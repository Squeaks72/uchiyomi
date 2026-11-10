// Volumes from a Wikipedia "List of … chapters" page (fork): the `{{Graphic novel list}}` rows, each a volume with the
// chapters it collects. Pure -- no database, no network -- so volumesWiki.test.ts runs it against saved pages.
//
// The chapter lists come in every shape editors have found since 2006, and all of them are read:
//   * `{{Numbered list|start=118|…|…}}`                     -- start, then one number per item
//   * `# "Title"` (wiki ordered list), `<li value="12">`    -- counted on from the volume before
//   * `* 001. "Title"`, `*1. "Title"`, `* Chapter 012: …`   -- the number the line itself names
//   * `* "Title"` with no number                            -- counted on, like `#`
// A line that is plainly not a numbered chapter ("Extra", "Bonus chapter", "Afterword", "Side story") is skipped:
// counting it would shift every chapter after it by one, and a volume would end one chapter late forever.
//
// A page can hold more than one series (a sequel's volumes under the first one's, a spin-off at the bottom): the
// volume numbers then start again at 1. Each such stretch is a RUN, and the caller picks the run whose chapters the
// library actually holds (pickRun). A page whose numbers go backwards inside a run is refused rather than guessed at.

export interface WikiVolume {
  /** As the page spells it: "1", "12", "0", "1.5". */
  label: string;
  /** Every chapter number the volume collects, ascending. */
  chapters: number[];
  /** The Japanese (original) release date as YYYY-MM-DD when the page gives one that parses. */
  released: string | null;
}

export interface WikiRun { volumes: WikiVolume[] }

/** Everything between `{{` and its matching `}}`, starting at `at` (which must point at the `{{`). */
function templateAt(s: string, at: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = at; i < s.length - 1; i++) {
    if (s[i] === '{' && s[i + 1] === '{') { depth++; i++; continue; }
    if (s[i] === '}' && s[i + 1] === '}') {
      depth--; i++;
      if (depth === 0) return { body: s.slice(at + 2, i - 1), end: i + 1 };
    }
  }
  return null;
}

/** Split a template body on the `|` that are not inside another template or a link. */
function topLevelParts(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; i++; continue; }
    if ((two === '}}' || two === ']]') && depth > 0) { depth--; i++; continue; }
    if (body[i] === '|' && depth === 0) { out.push(body.slice(from, i)); from = i + 1; }
  }
  out.push(body.slice(from));
  return out;
}

/** References and comments out: their dates, ISBNs and URLs are full of numbers that are not chapters. */
export function stripNoise(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, '');
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "August 18, 2020", "18 August 2020", "{{Start date|2020|8|18}}", "2020-08-18" -> "2020-08-18". */
export function parseWikiDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = stripNoise(raw);
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (y: number, m: number, d: number) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);
  let m = /\{\{\s*(?:start date|dts|date)\s*\|\s*(?:df=\w+\s*\|\s*)?(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return null;
}

// An item that is not a numbered chapter: counting it would push every later chapter one number up.
const NOT_A_CHAPTER = /^(?:['"“”‘’]{0,3}\s*)?(?:extra|bonus|special|side\s*story|omake|afterword|postscript|interlude|epilogue|prologue|one[- ]shot|short\s*story|preview|pilot|gaiden|appendix|cover\s+story|character\s+profile|illustration|making\s+of)\b/i;
// The number a `*` line names at its start: "001.", "1.", "Chapter 12:", "Ch. 3", "#4", "Episode 7 -", "Act 2".
const LEADING_NUMBER = /^\s*(?:['"]{2,3})?\s*(?:(?:chapter|ch|episode|ep|act|night|lesson|round|stage|step|file|case|story|record|scene|track|level|quest|mission|phase|log|report|karte|trip|bout|fight|game|match|period|hour|day|lap|tale|page|part|no)\b\.?\s*)?#?\s*(\d{1,4}(?:\.\d{1,2})?)(?!\d)\s*(?:['"]{2,3})?\s*(?:[.:)\-–—]|\s|$)/i;

/** `loose`: a `*` line with no number of its own -- a chapter when the whole list is like that, an extra when not. */
interface Item { n: number | null; loose?: boolean }

/** A `{{Numbered list|start=N|a|b}}`: N, N+1, … for its items. */
function numberedList(body: string): Item[] {
  const parts = topLevelParts(body).slice(1);
  let start = 1;
  const items: Item[] = [];
  for (const p of parts) {
    const named = /^\s*(start|style|list_style|list_style_type|item_style|item\d*_style|class|ul_style|ol_style|li_style)\s*=\s*(.*)$/is.exec(p);
    if (named) { if (named[1].toLowerCase() === 'start' && /^\d+$/.test(named[2].trim())) start = +named[2].trim(); continue; }
    if (!p.trim()) continue;
    items.push({ n: null });
  }
  return items.map((_, i) => ({ n: start + i }));
}

/** The chapter items of one volume's ChapterList text, in order; null n = "the one after the last". */
export function chapterItems(text: string): Item[] {
  const s = stripNoise(text);
  const items: Item[] = [];
  // `<ol start=N>` sets where the next unnumbered `<li>` counts from.
  let olStart: number | null = null;
  let i = 0;
  while (i < s.length) {
    const lineEnd = s.indexOf('\n', i);
    const next = lineEnd === -1 ? s.length : lineEnd + 1;
    const line = s.slice(i, lineEnd === -1 ? s.length : lineEnd);
    const nl = /^\s*\{\{\s*numbered list\s*\|/i.exec(line);
    if (nl) {
      const t = templateAt(s, i + line.indexOf('{{'));
      if (t) { items.push(...numberedList(t.body)); i = t.end; continue; }
    }
    const ol = /<ol\b[^>]*\bstart\s*=\s*"?(\d+)/i.exec(line);
    if (ol) olStart = Number(ol[1]);
    const lis = [...line.matchAll(/<li\b([^>]*)>/gi)];
    for (const li of lis) {
      const v = /\bvalue\s*=\s*"?(\d+(?:\.\d+)?)/i.exec(li[1]);
      if (v) items.push({ n: Number(v[1]) });
      else if (olStart !== null) items.push({ n: olStart });
      else items.push({ n: null });
      olStart = null;
    }
    const bullet = /^\s*([*#]+)\s?(.*)$/.exec(line);
    if (bullet && !lis.length) {
      const rest = bullet[2].trim();
      if (rest && !NOT_A_CHAPTER.test(rest.replace(/^\{\{\s*nihongo\s*\|/i, ''))) {
        const m = bullet[1].startsWith('#') ? null : LEADING_NUMBER.exec(rest);
        items.push(m ? { n: Number(m[1]) } : { n: null, loose: !bullet[1].startsWith('#') });
      }
    }
    i = next;
  }
  // A volume whose chapters carry numbers ("* Chapter 087:", a Numbered list) and also an unnumbered `*` line: that
  // line is an extra printed in the volume ("* Monster Chronicle", a bonus story after the list), not chapter n+1.
  return items.some((it) => it.n !== null) ? items.filter((it) => !it.loose) : items;
}

const CHAPTER_PARAM = /^\s*chapterlist(?:col\d+)?\s*=/i;

/** Every `{{Graphic novel list}}` row on the page, in page order, as runs (see the head of the file). */
export function parseVolumes(wikitext: string): WikiRun[] {
  const runs: WikiRun[] = [];
  let cur: WikiVolume[] = [];
  let last = 0; // the last chapter number seen, for the items that do not say theirs
  let lastVol = -Infinity;
  const re = /\{\{\s*graphic novel list\s*(?=\|)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext))) {
    const t = templateAt(wikitext, m.index);
    if (!t) break;
    re.lastIndex = t.end;
    const parts = topLevelParts(t.body).slice(1);
    const param = (name: RegExp) => parts.find((p) => name.test(p))?.replace(/^[^=]*=/, '');
    const label = stripNoise(param(/^\s*volumenumber\s*=/i) ?? '').replace(/'''?/g, '').trim();
    if (!label) continue;
    const volNum = Number(/^\d+(?:\.\d+)?/.exec(label)?.[0] ?? NaN);
    // Volume numbers going back to 1 (or 0) is a second series on the same page.
    if (Number.isFinite(volNum) && volNum <= 1 && lastVol >= 1 && cur.length) {
      runs.push({ volumes: cur });
      cur = [];
      last = 0;
    }
    if (Number.isFinite(volNum)) lastVol = volNum;
    const text = parts.filter((p) => CHAPTER_PARAM.test(p)).map((p) => p.replace(/^[^=]*=/, '')).join('\n');
    const chapters: number[] = [];
    for (const it of chapterItems(text)) {
      const n = it.n ?? Math.floor(last) + 1;
      chapters.push(n);
      last = n;
    }
    const released = parseWikiDate(param(/^\s*(?:originalreldate|reldate)\s*=/i));
    cur.push({ label: label.replace(/^0+(?=\d)/, ''), chapters, released });
  }
  if (cur.length) runs.push({ volumes: cur });
  return runs.map((r) => ({ volumes: r.volumes.filter((v) => v.chapters.length > 0) })).filter((r) => r.volumes.length > 0);
}

/**
 * Whether a run reads as a real volume list: chapters go up inside every volume and from one volume to the next,
 * allowing a decimal chapter or a numbered extra to sit out of line. A run that fails is not shown -- a wrong
 * volume list is worse than none, because it announces a volume as complete that is not.
 */
export function runIsSane(run: WikiRun): boolean {
  let bad = 0;
  let prevEnd = -Infinity;
  for (const v of run.volumes) {
    const ints = v.chapters.filter(Number.isInteger);
    for (let i = 1; i < ints.length; i++) if (ints[i] <= ints[i - 1]) { bad++; break; }
    if (ints.length && ints[0] <= prevEnd) bad++;
    if (ints.length) prevEnd = Math.max(prevEnd, ints[ints.length - 1]);
  }
  return bad <= Math.max(0, Math.floor(run.volumes.length * 0.05));
}

/**
 * The run that best fits the chapters the library holds: the most of its chapters held, then the longest. Null when
 * no sane run shares at least a few chapters with the library -- a page about another series of the same name.
 */
export function pickRun(runs: readonly WikiRun[], held: ReadonlySet<number>): WikiRun | null {
  let best: { run: WikiRun; hit: number; size: number } | null = null;
  for (const run of runs) {
    if (!runIsSane(run)) continue;
    const all = run.volumes.flatMap((v) => v.chapters);
    const hit = all.filter((n) => held.has(n)).length;
    if (!best || hit > best.hit || (hit === best.hit && all.length > best.size)) best = { run, hit, size: all.length };
  }
  if (!best) return null;
  if (held.size > 0 && best.hit < Math.min(3, held.size)) return null;
  return best.run;
}
