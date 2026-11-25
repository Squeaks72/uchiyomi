// A blocked group's chapters, taken off the shelf as though they had never been fetched (#396).
//
// Blocking a group hides, at once, every number only blocked groups released (lib/seriesListing.ts reapplyBlocklist),
// and nothing fetches one again. A chapter ALREADY downloaded from such a group stayed, though: a troll upload numbered
// 340 on a series at 240 sat at the top of the list, counted, and held its number. An admin may now remove those
// chapters completely, after being told how many there are -- the Sources & translations sheet and the Scanlation
// groups editor ask whenever there are any (blocking is still saved at once; removing is the confirmed second step).
//
//  - WHICH: rows in the download folder holding one chapter (never a range file, never a library built by hand), whose
//    override-aware number is either listed with every copy blocked (`series_listing.status = 'blocked'`) or listed by
//    nothing at all on a series that has a listing -- and whose file is that group's: the group stamped on the row
//    (lib_books.scanlator, written when the file landed) is blocked. A row stamped with no group goes only when the
//    listing proves every copy of its number is blocked; one stamped with an unblocked group never goes. Live files and
//    deleted chapters (tombstones) alike. The blocklist is the series' effective one: the server's and its own.
//  - NOTHING while the series' numbering is in question (a change pending or a renumber's journal): its numbers are
//    then not the listing's.
//  - WHAT GOES: what a removed source's leftovers lose (lib/sourceLeftovers.ts purgeBooks): the file, the row, its
//    reading progress, bookmarks and offline-download rows, and the by-number read marks and failure entries of each
//    number no other row still holds. reading_events stays, as it does there. Unblocking afterwards makes the number a
//    chapter the sources can fetch again, like any other not downloaded yet.
//  - CONFIRMED: the purge takes the ids the admin was shown and removes only those still eligible under the series'
//    writer claim and row locks, so nothing that changed since the count can go.
//  - KEPT COPIES (the fork's "Keep every source's copy", lib/bookVersionsRead.ts): a chapter is a file plus the other
//    sources' copies kept beside it (lib_book_versions, under `.versions/`), and deleting the row would cascade those
//    copies away and strand their files. So, per chapter:
//      · another group's copy is kept (stamped with a group that is not blocked, or with none): the chapter is NOT
//        removed. That copy is endorsed in its place (lib/endorse.ts endorseChapter -- the same path as the version row's
//        "Endorse this version": the row, its progress, bookmarks and stars stay), and the blocked group's file, kept as a
//        version by the endorse, is dropped once the new copy lands. Where the endorse cannot fetch that copy (its source
//        no longer lists it), the chapter is left as it is and reported in `left` as `kept_copy`.
//      · no such copy: the chapter goes as above, and so do the files of its (blocked) kept copies.
//    A kept copy stamped with a blocked group on any other chapter is listed in `copies` and dropped on its own
//    (lib/endorse.ts dropVersion); the chapter it sits beside is untouched.
import type { FastifyRequest } from 'fastify';
import { q, tx } from './db';
import { DL_ROOT } from './library';
import { groupsOf, mergePrefs, normGroup, type StoredPrefs } from './releases';
import { readGlobalPrefs } from './scanlatorPrefs';
import { purgeBooks, purgeRefusal, type LeftoverBook, type PurgeResult } from './sourceLeftovers';
import { heldBy } from './chapterRanges';
import { numKey } from './postingOrder';
import { dropVersion, endorseChapter } from './endorse';

type Query = typeof q;

/** One chapter a blocked group left on the shelf. */
export interface BlockedBook {
  id: string;
  seriesId: string;
  seriesTitle: string;
  /** The number the series shows it at (an admin's override, else the file's). */
  number: number;
  scanlator: string | null;
  pruned: boolean;
  /** Another group's copy of this chapter kept beside it (its source key): endorsed in its place instead of removing it. */
  keptCopy: string | null;
}

/** A kept copy (lib_book_versions) stamped with a blocked group, beside a chapter that itself stays. */
export interface BlockedCopy {
  bookId: string;
  sourceId: string;
  seriesId: string;
  number: number;
  scanlator: string | null;
}

export interface BlockedChapters {
  books: BlockedBook[];
  /** Kept copies by blocked groups beside chapters that stay (see the header). */
  copies: BlockedCopy[];
  /** Series with at least one such chapter. */
  series: number;
  /** Readers with progress on one of them. */
  readers: number;
}

interface Row {
  id: string; series_id: string; series_title: string; number: number; raw: number; override: number | null;
  scanlator: string | null; pruned: boolean; root: string; file: string; listed: string | null; series_prefs: unknown;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];

/** A series' own blocked names as the release rules read them (lib/seriesListing.ts storedPrefs): tolerant. */
const ownPrefs = (v: unknown): StoredPrefs | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return { priority: strings(o.priority), blocked: strings(o.blocked), patienceDays: null };
};

const isBlockedStamp = (scanlator: string | null, blocked: Set<string>): boolean => {
  const keys = groupsOf({ scanlator: scanlator ?? undefined }).map(normGroup).filter(Boolean);
  return keys.length > 0 && keys.every((k) => blocked.has(k));
};

/**
 * The chapters a blocked group left, in one series or (no `seriesId`) every series. Read-only. Candidates come from SQL
 * (one chapter per file, download folder, numbering settled, the number blocked or unlisted); the group test is the
 * release rules' own (groupsOf + normGroup over the series' effective blocklist), in JavaScript.
 */
export async function blockedChaptersOf(seriesId?: string | null, query: Query = q): Promise<BlockedChapters> {
  const rows = await query<Row>(
    `SELECT b.id, b.series_id, s.title AS series_title, COALESCE(ov.number, b.number)::float8 AS number,
            b.number::float8 AS raw, ov.number::float8 AS override, b.scanlator, (b.pruned_at IS NOT NULL) AS pruned,
            b.root, b.file, l.status AS listed, s.scanlator_prefs AS series_prefs
       FROM lib_books b
       JOIN lib_series s ON s.id = b.series_id
       LEFT JOIN book_overrides ov ON ov.book_id = b.id
       LEFT JOIN series_listing l ON l.series_id = b.series_id AND l.number = COALESCE(ov.number, b.number)
      WHERE ($1::text IS NULL OR b.series_id = $1)
        AND b.root = $2 AND b.number_end IS NULL
        AND s.numbering_pending IS NULL AND s.renumber_plan IS NULL
        AND (l.status = 'blocked'
             OR (l.series_id IS NULL AND b.scanlator IS NOT NULL
                 AND EXISTS (SELECT 1 FROM series_listing x WHERE x.series_id = b.series_id)))
      ORDER BY s.title, b.series_id, COALESCE(ov.number, b.number), b.file`,
    [seriesId ?? null, DL_ROOT],
  );
  // Every kept copy in scope, with its series' prefs: the ones beside a candidate decide its fate, the blocked ones elsewhere are listed.
  const versions = await query<{ book_id: string; source_id: string; scanlator: string | null; series_id: string; number: number; series_prefs: unknown }>(
    `SELECT v.book_id, v.source_id, v.scanlator, b.series_id, COALESCE(ov.number, b.number)::float8 AS number, s.scanlator_prefs AS series_prefs
       FROM lib_book_versions v
       JOIN lib_books b ON b.id = v.book_id
       JOIN lib_series s ON s.id = b.series_id
       LEFT JOIN book_overrides ov ON ov.book_id = b.id
      WHERE ($1::text IS NULL OR b.series_id = $1)
        AND s.numbering_pending IS NULL AND s.renumber_plan IS NULL
      ORDER BY b.series_id, b.id, v.source_id`,
    [seriesId ?? null],
  );
  if (!rows.length && !versions.length) return { books: [], copies: [], series: 0, readers: 0 };
  const global = await readGlobalPrefs();
  const blockedFor = new Map<string, Set<string>>();
  const blockedOf = (r: { series_id: string; series_prefs: unknown }) => {
    let set = blockedFor.get(r.series_id);
    if (!set) {
      set = new Set(mergePrefs(global, ownPrefs(r.series_prefs)).blocked.map(normGroup).filter(Boolean));
      blockedFor.set(r.series_id, set);
    }
    return set;
  };
  const versionsOf = new Map<string, typeof versions>();
  for (const v of versions) versionsOf.set(v.book_id, [...(versionsOf.get(v.book_id) ?? []), v]);
  const books: BlockedBook[] = [];
  for (const r of rows) {
    const keys = groupsOf({ scanlator: r.scanlator ?? undefined }).map(normGroup).filter(Boolean);
    const blocked = blockedOf(r);
    const stampBlocked = keys.length > 0 && keys.every((k) => blocked.has(k));
    // Stamped with no group: the file is one of the listed copies, all blocked -- only when the listing says so.
    if (!(stampBlocked || (keys.length === 0 && r.listed === 'blocked'))) continue;
    // A kept copy not stamped blocked (another group, or none named) is a reason to keep the chapter: never lost to a block.
    const kept = (versionsOf.get(r.id) ?? []).find((v) => !isBlockedStamp(v.scanlator, blocked));
    books.push({
      id: r.id, seriesId: r.series_id, seriesTitle: r.series_title, number: Number(r.number), scanlator: r.scanlator, pruned: !!r.pruned,
      keptCopy: kept?.source_id ?? null,
    });
  }
  const going = new Set(books.filter((b) => !b.keptCopy).map((b) => b.id));
  const copies: BlockedCopy[] = versions
    .filter((v) => !going.has(v.book_id) && isBlockedStamp(v.scanlator, blockedOf(v)))
    .map((v) => ({ bookId: v.book_id, sourceId: v.source_id, seriesId: v.series_id, number: Number(v.number), scanlator: v.scanlator }));
  if (!books.length && !copies.length) return { books: [], copies: [], series: 0, readers: 0 };
  // Readers lose history only on the chapters that go; a chapter whose kept copy is endorsed keeps its progress.
  const [readers] = await query<{ n: number }>(
    'SELECT count(DISTINCT user_id)::int AS n FROM read_progress WHERE book_id = ANY($1::text[])', [[...going]]);
  return { books, copies, series: new Set([...books.map((b) => b.seriesId), ...copies.map((c) => c.seriesId)]).size, readers: Number(readers?.n) || 0 };
}

export class BlockedPurgeRefused extends Error {
  constructor(public readonly reason: 'busy' | 'refused', message: string, public readonly fix?: string) { super(message); }
}

export interface BlockedPurgeResult extends Omit<PurgeResult, 'left'> {
  /** Series skipped because another task was changing them. */
  busy: string[];
  /** Chapters whose other group's kept copy is being endorsed in their place (see the header). */
  endorsed: number;
  /** Kept copies by blocked groups dropped. */
  copiesDropped: number;
  left: Array<{ id: string; reason: PurgeResult['left'][number]['reason'] | 'kept_copy' }>;
}

/**
 * Remove the chapters of `bookIds` that are still a blocked group's (see the header). Per series: the caller's writer
 * claim, then one transaction that locks the series, its listing and its rows, re-reads eligibility and purges the
 * intersection. A series another task holds is skipped and named in `busy`. One audit line per series,
 * `series.blocked_purge`.
 */
export async function purgeBlockedChapters(
  bookIds: readonly string[],
  o: { userId: string | null; req?: FastifyRequest; claim: (seriesId: string, folder: string) => { release: () => void } | null },
  /** Kept copies by blocked groups to drop, as `copies` listed them (`bookId|sourceId`). */
  copyKeys: readonly string[] = [],
): Promise<BlockedPurgeResult> {
  const out: BlockedPurgeResult = { removed: 0, bytes: 0, left: [], busy: [], endorsed: 0, copiesDropped: 0 };
  const wanted = new Set(bookIds);
  const wantedCopies = new Set(copyKeys);
  if (wantedCopies.size) {
    // Re-read: only what is still a blocked group's copy beside a chapter that stays.
    const ids = [...new Set([...wantedCopies].map((k) => k.split('|')[0]))];
    const series = (await q<{ series_id: string }>('SELECT DISTINCT series_id FROM lib_books WHERE id = ANY($1::text[])', [ids])).map((r) => r.series_id);
    for (const sid of series) {
      for (const c of (await blockedChaptersOf(sid)).copies) {
        if (!wantedCopies.has(`${c.bookId}|${c.sourceId}`)) continue;
        if (await dropVersion(c.bookId, c.sourceId).catch(() => false)) out.copiesDropped++;
      }
    }
  }
  if (!wanted.size) return out;
  const series = await q<{ id: string; folder: string }>(
    `SELECT DISTINCT s.id, s.folder FROM lib_books b JOIN lib_series s ON s.id = b.series_id
      WHERE b.id = ANY($1::text[]) ORDER BY s.id`, [[...wanted]]);
  for (const s of series) {
    const claim = o.claim(s.id, s.folder);
    if (!claim) { out.busy.push(s.id); continue; }
    // Chapters with another group's kept copy: endorsed once the claim is released (the endorse takes the series' download claim).
    const swaps: Array<{ id: string; number: number; keptCopy: string; blockedSource: string | null }> = [];
    try {
      const done = await tx(async (qq) => {
        const [locked] = await qq<{ folder: string; title: string }>('SELECT folder, title FROM lib_series WHERE id = $1 FOR UPDATE', [s.id]);
        if (!locked || locked.folder !== s.folder) return null;
        await qq('SELECT number FROM series_listing WHERE series_id = $1 FOR UPDATE', [s.id]);
        // Metadata edits and new read/bookmark rows do not claim the folder writer: lock the rows (and overrides), whose
        // FK parent locks then serialise new progress with the deletion -- as the source cleanup does (routes/admin.ts).
        await qq('SELECT id FROM lib_books WHERE series_id = $1 ORDER BY id FOR UPDATE', [s.id]);
        await qq(`SELECT ov.book_id FROM book_overrides ov JOIN lib_books b ON b.id = ov.book_id
                   WHERE b.series_id = $1 ORDER BY ov.book_id FOR UPDATE OF ov`, [s.id]);
        const found = (await blockedChaptersOf(s.id, qq)).books.filter((b) => wanted.has(b.id));
        if (found.some((b) => b.keptCopy)) {
          const raw = await qq<{ id: string; number: number; source_id: string | null }>(
            'SELECT id, number::float8 AS number, source_id FROM lib_books WHERE id = ANY($1::text[])', [found.filter((b) => b.keptCopy).map((b) => b.id)]);
          for (const r of raw) {
            const b = found.find((x) => x.id === r.id)!;
            swaps.push({ id: r.id, number: Number(r.number), keptCopy: b.keptCopy!, blockedSource: r.source_id });
          }
        }
        const eligible = found.filter((b) => !b.keptCopy);
        if (!eligible.length) return null;
        const ids = eligible.map((b) => b.id);
        const rows = await qq<{ id: string; number: number; override: number | null; root: string; file: string; pruned: boolean }>(
          `SELECT b.id, b.number::float8 AS number, ov.number::float8 AS override, b.root, b.file, (b.pruned_at IS NOT NULL) AS pruned
             FROM lib_books b LEFT JOIN book_overrides ov ON ov.book_id = b.id WHERE b.id = ANY($1::text[]) ORDER BY b.id`, [ids]);
        const books: LeftoverBook[] = rows.map((r) => ({
          id: r.id, number: Number(r.number), override: r.override == null ? null : Number(r.override),
          end: null, root: r.root, file: r.file, pruned: !!r.pruned,
        }));
        const refusal = await purgeRefusal(books);
        if (refusal) throw new BlockedPurgeRefused('refused', refusal.reason, refusal.fix);
        // The marks of a number go only when no row left behind holds it (a live chapter by another group, say).
        const stays = await qq<{ number: number; override: number | null; end: number | null }>(
          `SELECT b.number::float8 AS number, ov.number::float8 AS override, b.number_end::float8 AS end
             FROM lib_books b LEFT JOIN book_overrides ov ON ov.book_id = b.id
            WHERE b.series_id = $1 AND NOT (b.id = ANY($2::text[]))`, [s.id, ids]);
        const kept = heldBy(stays.flatMap((b) => [
          { number: Number(b.number), end: b.end == null ? null : Number(b.end) },
          ...(b.override == null ? [] : [{ number: Number(b.override), end: null }]),
        ]));
        const numbers = new Map<number, number>();
        for (const b of books) for (const n of [b.number, ...(b.override == null ? [] : [b.override])]) {
          if (!kept.has(n)) numbers.set(numKey(n), n);
        }
        // Their kept copies are all blocked groups' (else they would be swaps): the rows cascade with the chapter, the files go here.
        const keptFiles = await qq<{ book_id: string; source_id: string }>(
          'SELECT book_id, source_id FROM lib_book_versions WHERE book_id = ANY($1::text[])', [ids]);
        for (const v of keptFiles) if (await dropVersion(v.book_id, v.source_id).catch(() => false)) out.copiesDropped++;
        const { out: purged, numbers: gone } = await purgeBooks(s.id, books, [...numbers.values()].sort((a, b) => a - b), qq);
        await qq('INSERT INTO audit_log (user_id, event, detail, ip, user_agent) VALUES ($1,$2,$3,$4,$5)', [
          o.userId, 'series.blocked_purge',
          JSON.stringify({ id: s.id, title: locked.title, removed: purged.removed, bytes: purged.bytes, left: purged.left.length, numbers: gone.slice(0, 50) }),
          o.req?.ip?.slice(0, 64) ?? null, String(o.req?.headers['user-agent'] ?? '').slice(0, 200) || null,
        ]);
        return purged;
      });
      if (done) {
        out.removed += done.removed;
        out.bytes += done.bytes;
        out.left.push(...done.left);
      }
    } finally { claim.release(); }
    for (const w of swaps) {
      // The endorse fetches the kept copy's source's listed copy (lib/endorse.ts endorsePlan). A source that no longer lists the
      // chapter cannot: then nothing is written at all, not even the endorsement, and the chapter stays as it is.
      const [listed] = await q<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM series_listing l, jsonb_array_elements(COALESCE(l.copies, '[]'::jsonb)) c
                         WHERE l.series_id = $1 AND l.number = $2 AND c->>'source' = $3) AS ok`, [s.id, w.number, w.keptCopy]);
      if (!listed?.ok) { out.left.push({ id: w.id, reason: 'kept_copy' }); continue; }
      // Once the kept copy is the chapter's file, the blocked group's file (kept as a version by the endorse) goes.
      const r = await endorseChapter(s.id, w.number, w.keptCopy, o.userId, {
        onLanded: async () => { if (w.blockedSource) await dropVersion(w.id, w.blockedSource).catch(() => false); },
      }).catch(() => null);
      if (r && r.started > 0) out.endorsed++;
      else out.left.push({ id: w.id, reason: 'kept_copy' });
    }
  }
  return out;
}

