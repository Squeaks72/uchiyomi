// One adapter per tracker.
//
// `trackers.ts` was written with a note saying provider is carried everywhere "so MAL/Kitsu can be added
// without a migration", and that turned out to be true: the schema keys on (user_id, provider) and nothing
// needed changing. What was NOT abstracted was the calls that actually talk to a service -- prove a token,
// push progress and, since v0.36.0, read the account's list -- so those live here and the sync path and the
// import intake pick an adapter instead of hardcoding AniList.
//
// People connect by signing in (lib/trackerOauth.ts: AniList and MyAnimeList through a redirect back to the app,
// Kitsu with its username and password). Pasting an access token still works for each, for anyone who already
// has one and for installs where no admin has registered an application. Either way the token ends up in
// the same place, so everything below this comment neither knows nor cares which way it arrived.

export type Provider = 'anilist' | 'myanimelist' | 'kitsu';

/** The reading-list buckets every tracker has, in the app's own words; each adapter maps its service's names. */
export const LIST_STATUSES = ['reading', 'plan_to_read', 'completed', 'on_hold', 'dropped'] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];

/**
 * One entry of a person's list, as the import intake wants it: a search title (English first, the way the
 * add dialog searches), the other spellings for a second try, the bucket it sits in, how far the person got
 * there (the floor a first push must never go under), and whether it is a manga at all -- tracker "manga"
 * lists carry light novels, which would otherwise resolve to their adaptation and be linked to the wrong work.
 */
export interface LibraryEntry {
  externalId: string;
  title: string;
  altTitles: string[];
  status: ListStatus;
  progress: number;
  format: 'manga' | 'novel' | 'other';
  /** The person's own rating on a 0-10 scale; absent when they have not rated it (both services use 0 for that). */
  score?: number;
}
/** How many entries one intake reads at most: the review batch keeps 500, one more says "truncated". */
export const TRACKER_LIST_MAX = 501;

/**
 * The server's canonical title key, byte-for-byte the `norm` of routes/sources.ts. Not imported from there
 * because a lib module must not pull a route in (routes load `env`, which a unit test without a database
 * cannot satisfy), and duplicated on purpose so the intake's dedupe and the matcher's scoring agree on what
 * "the same title" means. ⚠️ Change one and the other must follow.
 */
export const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** A title field is only a title when something is left after trimming: MAL sends `""` for a missing English
 *  title and Kitsu sends `null`, and either would otherwise become the search term. */
const nonEmpty = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

/**
 * An alternate whose `normTitle` key is shorter than this is an abbreviation, not a title: AniList's synonyms
 * are full of `AoT`, `SnK`, `MHA`, `BNHA`, and Kitsu's abbreviatedTitles are the same list upper-cased. Such
 * a key never matches a result exactly, only by `contains`, and three letters are contained in almost any
 * title -- 'AoT' resolved 'Attack on Titan' to 'Chaotic Love Story' on the first source that lacked the
 * series, before the exact hit one source later was ever asked for. (The search TITLE is exempt: 'Ajin' is
 * a real four-letter title, and it is searched exactly, not by containment.)
 */
const MIN_ALT_KEY = 5;

/**
 * Pick the search title and the alternates from a provider's title fields, in order of preference: the first
 * non-empty one is the title, the rest are alternates deduped by `normTitle` (an English and a romaji field
 * that spell the same thing are one search) and capped at 3 — every alternate is one more outbound search
 * per source that misses. An alternate whose key normalises to nothing (a kana or hangul spelling) or to an
 * abbreviation (see MIN_ALT_KEY) is dropped: the matcher scores by that key, and a short or empty key
 * "contains"-matches every result. ⚠️ Reintroduce by dropping the `key.length < MIN_ALT_KEY` check: 'AoT'
 * is offered as a search term again and matches by containment on whichever source answers first.
 */
function titlesOf(fields: unknown[]): { title: string; altTitles: string[] } | null {
  const seen = new Set<string>();
  let title: string | null = null;
  const altTitles: string[] = [];
  for (const f of fields) {
    const s = nonEmpty(f);
    if (!s) continue;
    const key = normTitle(s);
    if (!title) { title = s; seen.add(key); continue; }
    if (!key || key.length < MIN_ALT_KEY || seen.has(key) || altTitles.length >= 3) continue;
    seen.add(key);
    altTitles.push(s);
  }
  return title ? { title, altTitles } : null;
}

/**
 * Where each service lives, overridable from the environment so the e2e instance can point an adapter at a
 * stub — the hosts were hardcoded, and there was no other way to drive a tracker import in a browser without
 * a real account. Read once at module load like the SCAN_* knobs; documented as test knobs.
 */
const apiUrl = (name: string, fallback: string): string => (process.env[name] || fallback).replace(/\/+$/, '');

export interface TrackerAdapter {
  readonly id: Provider;
  readonly label: string;
  /** Where a user gets a token, shown in the UI next to the paste box. */
  readonly tokenHelp: string;
  /** How long a token lasts, or null when the service does not say. Used to warn before it lapses. */
  readonly tokenDays: number | null;
  /** Prove the token works and name the account it belongs to. Throws or returns null when rejected. */
  whoAmI(token: string): Promise<{ id: string; name: string } | null>;
  /** Push progress. `externalId` is whatever linkSeries stored for this provider. */
  setProgress(token: string, externalId: string, chapters: number, finished: boolean): Promise<void>;
  /**
   * Read the account's own manga list, paged by our own offsets (never by following a URL the service hands
   * back) and capped at `max` entries. Throws `authFailed` on a rejected token exactly as setProgress does;
   * any other failure is a plain error and must not disable the connection.
   */
  listLibrary(token: string, opts: { statuses: ListStatus[]; max: number }): Promise<LibraryEntry[]>;
}

const authFail = (msg: string) => Object.assign(new Error(msg), { authFailed: true });

// ---------------------------------------------------------------------------- AniList

const ANILIST_API = apiUrl('ANILIST_API_URL', 'https://graphql.anilist.co');
/** AniList says "Invalid token" (HTTP 400) for a bad token and "Unauthorized" for a missing one. */
const ANILIST_BAD_TOKEN = /invalid token|unauthorized/i;

async function anilistCall(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
  const r = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  // Only a 401 is the token's verdict. ⚠️ A 403 from graphql.anilist.co is Cloudflare's, not AniList's: the
  // edge answers `403 error code: 1010/1020` (text/plain) to a client signature it dislikes, and mapping that
  // to authFail disabled every AniList connection with "rejected the saved token" the moment one push met
  // the edge -- the person had to paste a new token for a block that was never about the token. A 403 falls
  // through to the plain-error branch below: the message is recorded, the connection kept, the next chapter
  // retries. Reintroduce by adding `|| r.status === 403` back here.
  if (r.status === 401) throw authFail('tracker rejected the token');
  // A rejected token is an HTTP 400 on AniList, but so is every validation error -- a variable the schema
  // stopped accepting, a clamp that changed. Every 400 used to count as a bad token, which disables the
  // person's connection with "rejected the saved token"; the list query has far more ways to earn a 400 than
  // the two mutations had, so only the message decides now. ⚠️ Reintroduce by mapping every 400 to authFail.
  if (r.status === 400) {
    const j: any = await r.json().catch(() => null);
    const msg = j?.errors?.[0]?.message || 'anilist 400';
    if (ANILIST_BAD_TOKEN.test(msg)) throw authFail('tracker rejected the token');
    throw new Error(`anilist 400: ${msg}`);
  }
  if (!r.ok) throw new Error(`anilist ${r.status}`);
  const j: any = await r.json();
  if (j?.errors?.length) {
    const msg = j.errors[0]?.message || 'anilist error';
    throw Object.assign(new Error(msg), { authFailed: ANILIST_BAD_TOKEN.test(msg) });
  }
  return j.data;
}

/**
 * The list query: one chunk of the account's manga list, restricted to the statuses asked for. `chunk` and
 * `perChunk` page it (500 answered live; the loop is bounded by `hasNextChunk` and our cap either way), and
 * `forceSingleCompletedList` keeps a completed list that the person split by format from arriving as several
 * groups. `format` is read because a MANGA-type list carries NOVEL entries too.
 */
const ANILIST_LIST = `query($userId:Int,$statuses:[MediaListStatus],$chunk:Int,$perChunk:Int){
  MediaListCollection(userId:$userId,type:MANGA,status_in:$statuses,chunk:$chunk,perChunk:$perChunk,forceSingleCompletedList:true){
    hasNextChunk
    lists{ isCustomList entries{ mediaId status progress score(format:POINT_10_DECIMAL) media{ id format title{ romaji english } synonyms } } }
  }
}`;
const ANILIST_PER_CHUNK = 500;
/** AniList's list statuses per bucket: a re-read (REPEATING) is still being read, and PAUSED is on hold. */
const ANILIST_STATUS: Record<ListStatus, string[]> = {
  reading: ['CURRENT', 'REPEATING'],
  plan_to_read: ['PLANNING'],
  completed: ['COMPLETED'],
  on_hold: ['PAUSED'],
  dropped: ['DROPPED'],
};
function fromAnilistStatus(s: unknown): ListStatus | null {
  for (const st of LIST_STATUSES) if (ANILIST_STATUS[st].includes(String(s))) return st;
  return null;
}
const anilistFormat = (f: unknown): LibraryEntry['format'] =>
  f === 'MANGA' || f === 'ONE_SHOT' ? 'manga' : f === 'NOVEL' || f === 'LIGHT_NOVEL' ? 'novel' : 'other';

const ANILIST_SAVE = `mutation($mediaId:Int,$progress:Int,$status:MediaListStatus){
  SaveMediaListEntry(mediaId:$mediaId, progress:$progress, status:$status){ id progress status }
}`;

export const anilistAdapter: TrackerAdapter = {
  id: 'anilist',
  label: 'AniList',
  tokenHelp: 'Sign in with AniList, or paste an access token you already have.',
  tokenDays: 365,
  async whoAmI(token) {
    const d = await anilistCall(token, 'query{Viewer{id name}}', {});
    return d?.Viewer ? { id: String(d.Viewer.id), name: d.Viewer.name } : null;
  },
  async listLibrary(token, { statuses, max }) {
    if (!statuses.length || !(max > 0)) return []; // nothing asked for: no call, no paging through a whole list
    // Called through the adapter object, never `this`: a destructured method would lose it.
    const me = await anilistAdapter.whoAmI(token);
    if (!me) throw authFail('tracker rejected the token');
    const wanted = new Set(statuses);
    const anilistStatuses = statuses.flatMap((s) => ANILIST_STATUS[s]);
    // Custom lists repeat the entries of the status lists they were built from, and an entry hidden from its
    // status list (`hiddenFromStatusLists`) lives ONLY on a custom list -- so every group is read and the
    // mediaId decides, rather than skipping custom groups. ⚠️ Reintroduce by dropping the `seen` check: an
    // entry on a custom list arrives twice and the intake adds it twice.
    const seen = new Set<string>();
    const out: LibraryEntry[] = [];
    for (let chunk = 1; ; chunk++) {
      const d = await anilistCall(token, ANILIST_LIST, {
        userId: Number(me.id), statuses: anilistStatuses, chunk, perChunk: ANILIST_PER_CHUNK,
      });
      const col = d?.MediaListCollection;
      for (const group of col?.lists ?? []) {
        for (const e of group?.entries ?? []) {
          const mediaId = e?.mediaId ?? e?.media?.id;
          if (mediaId == null || seen.has(String(mediaId))) continue;
          const status = fromAnilistStatus(e.status);
          if (!status || !wanted.has(status)) continue;
          const t = titlesOf([e.media?.title?.english, e.media?.title?.romaji, ...(e.media?.synonyms ?? [])]);
          if (!t) continue;
          seen.add(String(mediaId));
          out.push({
            externalId: String(mediaId), ...t, status,
            progress: Math.max(0, Math.floor(Number(e.progress) || 0)),
            format: anilistFormat(e.media?.format),
            ...(Number(e.score) > 0 ? { score: Number(e.score) } : {}),
          });
          if (out.length >= max) return out;
        }
      }
      if (!col?.hasNextChunk) return out;
    }
  },
  async setProgress(token, externalId, chapters, finished) {
    await anilistCall(token, ANILIST_SAVE, {
      mediaId: Number(externalId),
      progress: chapters,
      status: finished ? 'COMPLETED' : 'CURRENT',
    });
  },
};

// ---------------------------------------------------------------------------- MyAnimeList

const MAL_API = apiUrl('MYANIMELIST_API_URL', 'https://api.myanimelist.net/v2');
/** The spec's ceiling for `limit` on the list endpoint (the default is 100). */
const MAL_PAGE = 1000;
/** MAL's list statuses are the app's own words already; a re-read (`is_rereading`) comes back under reading. */
const MAL_STATUS: Record<ListStatus, string> = {
  reading: 'reading', plan_to_read: 'plan_to_read', completed: 'completed', on_hold: 'on_hold', dropped: 'dropped',
};
const malFormat = (t: unknown): LibraryEntry['format'] => {
  const s = String(t ?? '');
  if (s === 'novel' || s === 'light_novel') return 'novel';
  return ['manga', 'one_shot', 'doujinshi', 'manhwa', 'manhua', 'oel'].includes(s) ? 'manga' : 'other';
};

async function malCall(token: string, path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${MAL_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(init?.headers as any) },
    signal: AbortSignal.timeout(15000),
  });
  // A 401 is a bad token. A 403 on MAL is its DoS block (too many requests from one address), which a token
  // paste cannot fix; treating it as authFail disabled the connection for a rate limit. Reintroduce by
  // adding `|| r.status === 403` back.
  if (r.status === 401) throw authFail('MyAnimeList rejected the token');
  if (!r.ok) throw new Error(`myanimelist ${r.status}`);
  return r.status === 204 ? null : r.json();
}

export const malAdapter: TrackerAdapter = {
  id: 'myanimelist',
  label: 'MyAnimeList',
  // MAL issues tokens through OAuth2 with PKCE; the practical path for a self-hoster is to obtain one once
  // and paste it, exactly as with AniList.
  tokenHelp: 'Sign in with MyAnimeList, or paste an access token you already have.',
  tokenDays: 31,   // MAL access tokens are short-lived; surfacing that is the whole point of storing it
  async listLibrary(token, { statuses, max }) {
    if (!statuses.length || !(max > 0)) return [];
    const out: LibraryEntry[] = [];
    const seen = new Set<string>();
    // `status` takes ONE value ("to return all manga, don't specify"), so a subset is one paged loop per bucket.
    // `nsfw=true` is not optional: without it the gray and black entries are silently left out of the
    // answer, and a list that "imported fine" is missing titles nobody can account for.
    // Every bucket asked for is ONE paged read with no `status` (the row says which bucket it is in), not
    // five: a full-list read for recommendations costs a call per thousand entries instead of a call per bucket.
    const everything = LIST_STATUSES.every((s) => statuses.includes(s));
    const wanted = new Set<string>(statuses);
    for (const pass of everything ? [null] : statuses) {
      for (let offset = 0, more = true; more; ) {
        const qs = new URLSearchParams({
          fields: 'list_status,alternative_titles,media_type',
          limit: String(MAL_PAGE), offset: String(offset), nsfw: 'true',
        });
        if (pass) qs.set('status', MAL_STATUS[pass]);
        const d = await malCall(token, `/users/@me/mangalist?${qs}`);
        const rows: any[] = Array.isArray(d?.data) ? d.data : [];
        // `paging.next` is only a signal that there is more. It is a URL the service composed, and this
        // server fetches nothing it did not compose itself; the next page is our own offset, advanced by
        // what was actually served so a clamped page size cannot skip entries. An empty page ends the loop
        // whatever `next` says. ⚠️ Reintroduce by `fetch(d.paging.next)`.
        more = !!d?.paging?.next && rows.length > 0;
        offset += rows.length;
        for (const row of rows) {
          const node = row?.node;
          if (node?.id == null || seen.has(String(node.id))) continue;
          const st = (pass ?? row?.list_status?.status) as ListStatus | undefined;
          if (!st || !wanted.has(st) || !(LIST_STATUSES as readonly string[]).includes(st)) continue;
          // `title` is the romaji; the English title lives under alternative_titles.en and is "" when there
          // is none, so the trim rule in titlesOf is what makes the romaji the search title in that case.
          const alt = node.alternative_titles ?? {};
          const t = titlesOf([alt.en, node.title, ...(Array.isArray(alt.synonyms) ? alt.synonyms : [])]);
          if (!t) continue;
          seen.add(String(node.id));
          out.push({
            externalId: String(node.id), ...t, status: st,
            progress: Math.max(0, Math.floor(Number(row?.list_status?.num_chapters_read) || 0)),
            format: malFormat(node.media_type),
            ...(Number(row?.list_status?.score) > 0 ? { score: Number(row.list_status.score) } : {}),
          });
          if (out.length >= max) return out;
        }
      }
    }
    return out;
  },
  async whoAmI(token) {
    const d = await malCall(token, '/users/@me?fields=name');
    return d?.name ? { id: String(d.id ?? d.name), name: d.name } : null;
  },
  async setProgress(token, externalId, chapters, finished) {
    // MAL takes a form body, not JSON, and calls the field num_chapters_read.
    const body = new URLSearchParams({
      num_chapters_read: String(chapters),
      status: finished ? 'completed' : 'reading',
    });
    await malCall(token, `/manga/${encodeURIComponent(externalId)}/my_list_status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  },
};

// ---------------------------------------------------------------------------- Kitsu

// kitsu.app is the host the service itself links to now (`links.next` comes back on it); kitsu.io still answers.
const KITSU_API = apiUrl('KITSU_API_URL', 'https://kitsu.app/api/edge');
const KITSU_JSON = 'application/vnd.api+json';
/** `page[limit]=501` is a 400 on Kitsu, so 500 is the ceiling. */
const KITSU_PAGE = 500;
/** Kitsu calls reading `current` and plan-to-read `planned`; the other three are the app's own words. */
const KITSU_STATUS: Record<ListStatus, string> = {
  reading: 'current', plan_to_read: 'planned', completed: 'completed', on_hold: 'on_hold', dropped: 'dropped',
};
function fromKitsuStatus(s: unknown): ListStatus | null {
  for (const st of LIST_STATUSES) if (KITSU_STATUS[st] === s) return st;
  return null;
}
const kitsuFormat = (t: unknown): LibraryEntry['format'] => {
  const s = String(t ?? '');
  if (s === 'novel') return 'novel';
  return ['manga', 'manhwa', 'manhua', 'oel', 'oneshot', 'doujin'].includes(s) ? 'manga' : 'other';
};

async function kitsuCall(token: string, path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${KITSU_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`, accept: KITSU_JSON, ...(init?.headers as any),
    },
    signal: AbortSignal.timeout(15000),
  });
  // A 401 is a bad token. A 403 on Kitsu is a forbidden ACTION -- writing an entry that belongs to another
  // account, say -- and the token that earned it is still good for everything else, so it is a plain error
  // that keeps the connection. Reintroduce by adding `|| r.status === 403` back.
  if (r.status === 401) throw authFail('Kitsu rejected the token');
  if (!r.ok) throw new Error(`kitsu ${r.status}`);
  return r.status === 204 ? null : r.json();
}

export const kitsuAdapter: TrackerAdapter = {
  id: 'kitsu',
  label: 'Kitsu',
  tokenHelp: 'Sign in with your Kitsu username and password, or paste an access token you already have.',
  tokenDays: 30,
  async listLibrary(token, { statuses, max }) {
    if (!statuses.length || !(max > 0)) return []; // an empty filter[status] would page the whole library
    const me = await kitsuAdapter.whoAmI(token);
    if (!me) throw authFail('Kitsu rejected the token');
    const wanted = new Set(statuses);
    const out: LibraryEntry[] = [];
    const seen = new Set<string>();
    for (let offset = 0, more = true; more; ) {
      // JSON:API: the entries carry status and progress, the manga they point at rides in `included` and is
      // joined by id -- `included` is not in the entries' order. `filter[status]` takes a comma list.
      const qs = new URLSearchParams({
        'filter[userId]': me.id, 'filter[kind]': 'manga',
        'filter[status]': statuses.map((s) => KITSU_STATUS[s]).join(','),
        include: 'manga',
        'fields[libraryEntries]': 'status,progress,manga',
        'fields[manga]': 'canonicalTitle,titles,abbreviatedTitles,subtype',
        'page[limit]': String(KITSU_PAGE), 'page[offset]': String(offset),
      });
      const d = await kitsuCall(token, `/library-entries?${qs}`);
      const rows: any[] = Array.isArray(d?.data) ? d.data : [];
      const manga = new Map<string, any>();
      for (const inc of d?.included ?? []) if (inc?.type === 'manga' && inc.id != null) manga.set(String(inc.id), inc.attributes ?? {});
      // `links.next` is the signal, never the address: the next page is our own offset (see the MAL adapter).
      more = !!d?.links?.next && rows.length > 0;
      offset += rows.length;
      for (const row of rows) {
        // ⚠️ The external id is the MANGA id, not this entry's id. An entry belongs to ONE account, while
        // series_trackers is keyed per series: an entry id stored here would send every other member's push
        // at the importer's entry and get a 403 on every chapter, so THEIR progress never arrives and their
        // card shows a sync error they cannot fix. Reintroduce by storing `row.id`.
        const mangaId = row?.relationships?.manga?.data?.id;
        if (mangaId == null || seen.has(String(mangaId))) continue;
        const status = fromKitsuStatus(row?.attributes?.status);
        if (!status || !wanted.has(status)) continue;
        const m = manga.get(String(mangaId));
        if (!m) continue; // an entry whose manga was not included cannot be searched for
        const titles = m.titles ?? {};
        const t = titlesOf([
          titles.en, titles.en_us, m.canonicalTitle, titles.en_jp,
          ...(Array.isArray(m.abbreviatedTitles) ? m.abbreviatedTitles : []),
        ]);
        if (!t) continue;
        seen.add(String(mangaId));
        out.push({
          externalId: String(mangaId), ...t, status,
          progress: Math.max(0, Math.floor(Number(row?.attributes?.progress) || 0)),
          format: kitsuFormat(m.subtype),
        });
        if (out.length >= max) return out;
      }
    }
    return out;
  },
  async whoAmI(token) {
    const d = await kitsuCall(token, '/users?filter[self]=true');
    const u = d?.data?.[0];
    return u ? { id: String(u.id), name: u.attributes?.name ?? u.attributes?.slug ?? 'kitsu' } : null;
  },
  async setProgress(token, externalId, chapters, finished) {
    // `externalId` is the Kitsu MANGA id, the one thing about a series that is the same for every account.
    // The entry to write is the CALLER's own, resolved here by user and manga: it used to be a stored
    // library-entry id, which belongs to one account, so after an admin's import every other member's push
    // would have PATCHed the admin's entry, got a 403 on every chapter, and never synced a thing.
    // ⚠️ Reintroduce by PATCHing `/library-entries/${externalId}` directly.
    const me = await kitsuAdapter.whoAmI(token);
    if (!me) throw authFail('Kitsu rejected the token');
    const qs = new URLSearchParams({
      'filter[userId]': me.id, 'filter[mangaId]': String(externalId),
      'fields[libraryEntries]': 'status', 'page[limit]': '1',
    });
    const found = await kitsuCall(token, `/library-entries?${qs}`);
    const entryId = found?.data?.[0]?.id;
    const attributes = { progress: chapters, status: finished ? 'completed' : 'current' };
    if (entryId != null) {
      await kitsuCall(token, `/library-entries/${encodeURIComponent(String(entryId))}`, {
        method: 'PATCH',
        headers: { 'content-type': KITSU_JSON },
        body: JSON.stringify({ data: { id: String(entryId), type: 'libraryEntries', attributes } }),
      });
      return;
    }
    // No entry yet on this account: create one, the way the Kitsu clients do (user + media relationships).
    await kitsuCall(token, '/library-entries', {
      method: 'POST',
      headers: { 'content-type': KITSU_JSON },
      body: JSON.stringify({
        data: {
          type: 'libraryEntries',
          attributes,
          relationships: {
            user: { data: { type: 'users', id: me.id } },
            media: { data: { type: 'manga', id: String(externalId) } },
          },
        },
      }),
    });
  },
};

// ---------------------------------------------------------------------------- Recommendations

/**
 * One title another reader suggested, in the shape lib/trackerRecs.ts caches. `votes` is how strongly the
 * community stands behind the pairing (AniList's net rating, MyAnimeList's `num_recommendations`).
 * `adult` is null when the service did not say, which only MyAnimeList's own answer ever leaves.
 */
export interface RecItem {
  id: string;
  title: string;
  altTitles: string[];
  cover: string | null;
  url: string | null;
  /** 0-100, the community's score; null when there is none. */
  score: number | null;
  adult: boolean | null;
  format: LibraryEntry['format'];
  votes: number;
}

const ANILIST_MEDIA = 'id idMal type format isAdult averageScore siteUrl title{ romaji english } synonyms coverImage{ large medium }';

function anilistItem(m: any, votes: number): RecItem | null {
  if (!m || m.id == null || (m.type && m.type !== 'MANGA')) return null;
  const t = titlesOf([m.title?.english, m.title?.romaji, ...(Array.isArray(m.synonyms) ? m.synonyms : [])]);
  if (!t) return null;
  return {
    id: String(m.id), ...t,
    cover: nonEmpty(m.coverImage?.large) ?? nonEmpty(m.coverImage?.medium),
    url: nonEmpty(m.siteUrl),
    score: Number(m.averageScore) > 0 ? Math.round(Number(m.averageScore)) : null,
    adult: typeof m.isAdult === 'boolean' ? m.isAdult : null,
    format: anilistFormat(m.format),
    votes,
  };
}

/**
 * What AniList readers recommend after each of these series, as ONE request: the ids are aliases of a single
 * query rather than a call each. The query is public, so no token is sent -- a recommendation is the same
 * for everyone and need not carry anyone's credentials. Only pairings the community voted up (net rating
 * above zero) are kept, best first. An id AniList does not know simply has no entry in the answer.
 */
export async function anilistRecommendations(ids: string[], perSeed = 12): Promise<Map<string, RecItem[]>> {
  const out = new Map<string, RecItem[]>();
  const wanted = ids.filter((i) => /^\d+$/.test(i));
  if (!wanted.length) return out;
  const body = wanted.map((id, n) =>
    `m${n}: Media(id:${Number(id)}, type:MANGA){ id recommendations(sort:RATING_DESC, perPage:${perSeed}){ nodes{ rating mediaRecommendation{ ${ANILIST_MEDIA} } } } }`,
  ).join('\n');
  const r = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: `query{ ${body} }` }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok && r.status !== 404) throw new Error(`anilist ${r.status}`);
  const j: any = await r.json().catch(() => null);
  // A seed that no longer exists answers a per-alias "Not Found" error next to the aliases that worked; only
  // an answer with no data at all is a failure.
  if (!j?.data) throw new Error(`anilist ${j?.errors?.[0]?.message || 'no data'}`);
  wanted.forEach((id, n) => {
    const nodes: any[] = j.data[`m${n}`]?.recommendations?.nodes ?? [];
    const items: RecItem[] = [];
    for (const node of nodes) {
      const votes = Number(node?.rating) || 0;
      if (votes <= 0) continue;
      const item = anilistItem(node?.mediaRecommendation, votes);
      if (item) items.push(item);
    }
    out.set(id, items);
  });
  return out;
}

/**
 * What MyAnimeList readers recommend after one series. One call, the person's own token (the endpoint needs
 * a client id or a bearer and the token is the one already held). MyAnimeList says nothing about age rating
 * here, so `adult` is null until lib/trackerRecs.ts asks AniList about the whole batch at once.
 */
export async function malRecommendations(token: string, malId: string): Promise<RecItem[]> {
  if (!/^\d+$/.test(malId)) return [];
  let d: any;
  try {
    d = await malCall(token, `/manga/${malId}?fields=recommendations`);
  } catch (e) {
    if (/ 404$/.test((e as Error).message)) return []; // gone from MyAnimeList: nothing to recommend, and no use asking again
    throw e;
  }
  const out: RecItem[] = [];
  for (const rec of Array.isArray(d?.recommendations) ? d.recommendations : []) {
    const node = rec?.node;
    const title = nonEmpty(node?.title);
    if (node?.id == null || !title) continue;
    out.push({
      id: String(node.id), title, altTitles: [],
      cover: nonEmpty(node.main_picture?.large) ?? nonEmpty(node.main_picture?.medium),
      url: `https://myanimelist.net/manga/${node.id}`,
      score: null, adult: null, format: 'other',
      votes: Math.max(1, Math.floor(Number(rec?.num_recommendations) || 1)),
    });
  }
  return out;
}

/**
 * AniList's record for a batch of MyAnimeList ids, in one request (`idMal_in`): the age rating, format,
 * English title and score MyAnimeList's recommendations lack. Up to 50 ids, which is one page. Public, no token.
 */
export async function anilistByMalIds(malIds: string[]): Promise<Map<string, RecItem>> {
  const out = new Map<string, RecItem>();
  const ids = malIds.filter((i) => /^\d+$/.test(i)).slice(0, 50).map(Number);
  if (!ids.length) return out;
  const r = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      query: `query($ids:[Int]){ Page(perPage:50){ media(idMal_in:$ids, type:MANGA){ ${ANILIST_MEDIA} } } }`,
      variables: { ids },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`anilist ${r.status}`);
  const j: any = await r.json().catch(() => null);
  for (const m of j?.data?.Page?.media ?? []) {
    const item = anilistItem(m, 0);
    if (item && m.idMal != null) out.set(String(m.idMal), item);
  }
  return out;
}

// ----------------------------------------------------------------------------

export const ADAPTERS: Record<Provider, TrackerAdapter> = {
  anilist: anilistAdapter,
  myanimelist: malAdapter,
  kitsu: kitsuAdapter,
};

export const PROVIDERS = Object.keys(ADAPTERS) as Provider[];

export const isProvider = (v: unknown): v is Provider =>
  typeof v === 'string' && (PROVIDERS as string[]).includes(v);
