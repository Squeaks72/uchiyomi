// Finding a series' volume list on Wikipedia (fork). The series' AniList entry is the key: Wikidata knows which article
// is about that AniList entry (property P8731, "AniList manga ID"), and the volume list is either that article's own
// "List of … chapters" page or a section of the article itself. No title search: a search for "Monster" finds a page
// about monsters, and a wrong volume list is worse than none.
//
// Wikimedia asks every client for a User-Agent that says who it is, and for no more than one request at a time; one
// gate lane, a second between requests. A whole library is a few hundred requests, once a fortnight.
import { withGate } from '../gate';
import { parseVolumes, pickRun, type WikiVolume } from './wikiParse';

const UA = 'Uchiyomi/1.0 (self-hosted manga server; volume lists)';
const WIKI = (process.env.WIKIPEDIA_API_URL || 'https://en.wikipedia.org/w/api.php').replace(/\/+$/, '');
const SPARQL = (process.env.WIKIDATA_SPARQL_URL || 'https://query.wikidata.org/sparql').replace(/\/+$/, '');

async function getJson(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<any> {
  return withGate('wikimedia', async () => {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: { 'user-agent': UA, accept: 'application/json, application/sparql-results+json', ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`wikimedia answered ${res.status}`);
    return res.json();
  }, { concurrency: 1, minGapMs: 1000 });
}

/** AniList id -> the English Wikipedia article about that work, for every id Wikidata knows. */
export async function articlesForAniList(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const clean = [...new Set(ids.filter((id) => /^\d{1,9}$/.test(id)))];
  for (let i = 0; i < clean.length; i += 150) {
    const values = clean.slice(i, i + 150).map((id) => `"${id}"`).join(' ');
    const query = `SELECT ?al ?article WHERE { VALUES ?al { ${values} } ?item wdt:P8731 ?al. ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> }`;
    const j = await getJson(SPARQL, {
      method: 'POST',
      body: new URLSearchParams({ query, format: 'json' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    for (const b of j?.results?.bindings ?? []) {
      const al = b?.al?.value;
      const url = b?.article?.value;
      if (typeof al !== 'string' || typeof url !== 'string') continue;
      const title = decodeURIComponent(url.replace(/^.*\/wiki\//, '')).replace(/_/g, ' ');
      if (title && !out.has(al)) out.set(al, title);
    }
  }
  return out;
}

/** The pages a volume list is usually on, most likely first. The article itself comes last. */
export function candidatePages(article: string): string[] {
  const base = article.replace(/\s*\([^)]*\)\s*$/, '');
  return [...new Set([
    `List of ${article} chapters`, `List of ${base} chapters`,
    `List of ${base} manga volumes`, `List of ${article} volumes`, `List of ${base} volumes`,
    article,
  ])];
}

/** Which of these titles exist, each followed through its redirect: title asked -> page title. */
async function existing(titles: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const j = await getJson(`${WIKI}?${new URLSearchParams({ action: 'query', titles: chunk.join('|'), redirects: '1', format: 'json', formatversion: '2' })}`);
    const norm = new Map<string, string>((j?.query?.normalized ?? []).map((r: any) => [r.from, r.to]));
    const redir = new Map<string, string>((j?.query?.redirects ?? []).map((r: any) => [r.from, r.to]));
    const ok = new Set<string>((j?.query?.pages ?? []).filter((p: any) => !p.missing && !p.invalid).map((p: any) => p.title));
    for (const t of chunk) {
      const a = norm.get(t) ?? t;
      const b = redir.get(a) ?? a;
      if (ok.has(b)) out.set(t, b);
    }
  }
  return out;
}

async function wikitext(page: string): Promise<string | null> {
  const j = await getJson(`${WIKI}?${new URLSearchParams({ action: 'parse', page, prop: 'wikitext', format: 'json', formatversion: '2', redirects: '1' })}`);
  const t = j?.parse?.wikitext;
  return typeof t === 'string' ? t : null;
}

export interface WikiFind { page: string; volumes: WikiVolume[] }

/**
 * The volume list for a work whose Wikipedia article is `article`, matched against the chapters the library holds:
 * the first candidate page with a volume list that fits them. Null when none does.
 */
export async function findVolumes(article: string, held: ReadonlySet<number>): Promise<WikiFind | null> {
  const cands = candidatePages(article);
  const there = await existing(cands);
  const tried = new Set<string>();
  for (const c of cands) {
    const page = there.get(c);
    if (!page || tried.has(page)) continue;
    tried.add(page);
    const text = await wikitext(page);
    if (!text || !/\{\{\s*graphic novel list\s*\|/i.test(text)) continue;
    const run = pickRun(parseVolumes(text), held);
    if (run) return { page, volumes: run.volumes };
  }
  return null;
}
