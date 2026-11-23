// Put another copy of a chapter on its row (the set-aside-and-restore path), callable: POST /api/admin/series/:id/chapters/refetch is a thin
// wrapper over it, and lib/endorse.ts uses it to put the endorsed source's copy on a chapter's row. It lived in routes/admin.ts, which made
// lib/endorse.ts import a route and tied autofix, findSources, mainSource, backupExtensions and endorse into one import cycle with it.
import type { FastifyRequest } from 'fastify';
import { q, one } from './db';
import { DL_ROOT, setBookMeta } from './library';
import { containedPath, allWritable, realContainedPath } from './fsGuard';
import { updateSeries } from './updater';
import { copyToChapter } from './seriesListing';
import { tombstoneBooks } from './chapterCleanup';
import { logAudit } from './audit';
import { isDisabled, blockedNow } from './sourceHealth';
import { getSource, withTimeout } from './sources';
import { rm, rename, stat } from 'fs/promises';
import { resolve } from 'path';
import { jobBusy, claimDownloadJob, releaseDownloadJobClaim, startDownloadJob, REFRESH_BUDGET_MS } from '../routes/sources';
import { isOwnFile } from './chapterFile';
import { REFETCH_BAK } from './fsAtomic';
import type { SourceChapter } from './sources/types';
import { type ListingCopy } from './seriesListing';
import { languageRulesFor, type LanguageRules } from './copyLanguage';

/** The rows a chapter action was asked about, with everything the classification needs. */
const chapterRows = (seriesId: string, ids: string[]) =>
  q<{ id: string; root: string | null; file: string; number: number; pruned_at: string | null }>(
    'SELECT id, root, file, number, pruned_at FROM lib_books WHERE series_id = $1 AND id = ANY($2)', [seriesId, ids]);

export interface RefetchOpts {
  /** Who asked: the audit line and the job's owner. Null for the server's own passes (lib/endorse.ts). */
  by: string | null;
  req?: FastifyRequest;
  /** Refresh the listing first (default true). */
  refresh?: boolean;
  /** Called once the rows are chosen and checked, before any file is set aside. */
  beforeSetAside?: (rows: Array<{ id: string; number: number; abs: string; source: string }>) => Promise<void>;
  /** Called per row whose new copy landed. */
  onLanded?: (bookId: string) => Promise<void>;
  /** Called per row whose copy did NOT land (failed, or cancelled), after the old file is put back. The job runs detached, so this is the only way a caller learns of it. */
  onFailed?: (bookId: string) => Promise<void> | void;
}

/**
 * POST /api/admin/series/:id/chapters/refetch, callable (the route's doc says what it does): also how lib/endorse.ts puts the endorsed
 * source's copy on a chapter's row. Answers what the route would, as `{ code, body }`.
 */
export async function refetchChapters(
  id: string,
  data: { bookIds?: string[]; picks?: Array<{ bookId: string; source: string; sourceId: string }> },
  opts: RefetchOpts,
): Promise<{ code: number; body: any }> {
  const done = (code: number, body: any) => ({ code, body });
  const b = { data };
    const s = await one<any>(
      `SELECT id, title, folder, summary, author, genres, web, status, source_id FROM lib_series WHERE id = $1`, [id]);
    if (!s) return done(404, { error: 'not_found' });
    // First pick per row wins; a row named in both lists is fetched as its pick, the more specific ask. A
    // second pick for the same row is reported as `duplicate`, as on POST /api/sources/fetch, rather than
    // dropped without a word.
    const skipped: Array<{ id: string; reason: string; source?: string; sourceId?: string }> = [];
    const pickOf = new Map<string, { source: string; sourceId: string }>();
    for (const pk of b.data.picks ?? []) {
      if (!pickOf.has(pk.bookId)) pickOf.set(pk.bookId, pk);
      // Named like the fetch route's entry: a scripted caller sending two copies for one row must be able
      // to tell WHICH one was ignored.
      else skipped.push({ id: pk.bookId, reason: 'duplicate', source: pk.source, sourceId: pk.sourceId });
    }
    const ids = [...new Set([...(b.data.bookIds ?? []), ...pickOf.keys()])];
    const rows = new Map((await chapterRows(id, ids)).map((r) => [r.id, r]));

    const eligible: Array<{ id: string; number: number; file: string; abs: string; pruned: boolean }> = [];
    const root = resolve(DL_ROOT);
    for (const bid of ids) {
      const r = rows.get(bid);
      if (!r) { skipped.push({ id: bid, reason: 'not_found' }); continue; }
      if (r.root !== DL_ROOT) { skipped.push({ id: bid, reason: 'not_owned' }); continue; }
      const number = Number(r.number);
      const abs = containedPath(DL_ROOT, r.file);
      const realSafe = abs ? await realContainedPath(DL_ROOT, r.file) : null;
      // The root itself can never be the chapter file (the path check below already forbids it: a chapter
      // file ends in `Chapter <n>.cbz`), but the rename below is a destructive move and the comparison is
      // free -- the same guard the delete route and the cleanup carry.
      if (!abs || realSafe !== abs || abs === root || !isOwnFile(r.file, s.folder, number)) { skipped.push({ id: bid, reason: 'not_ours' }); continue; }
      eligible.push({ id: bid, number, file: r.file, abs, pruned: !!r.pruned_at });
    }
    // The listing is refreshed FIRST, so the copy fetched is the one the release rules choose NOW -- which
    // is the promise this route makes ("after a change of priority ... another group's"). A preferences
    // save never touches series_listing, so without this the row still held the copy the LAST sweep chose:
    // an admin who ranked Group B and clicked Fetch again got Group A's identical copy back and a toast
    // saying nothing had changed. maxNew 0 lists and persists and breaks before any download; a source
    // that does not answer leaves the previous listing standing (stale beats empty, lib/updater.ts), and
    // the not_listed / source_unavailable paths below handle that. Best effort: the refresh must never be
    // the thing that stops a fetch.
    // Reintroduce by dropping this call: "fetch again takes the copy the rules choose now, not the one the
    // last check chose" in chapterActions.int.test.ts downloads the old group's copy.
    // Bounded like the member-facing fetch (REFRESH_BUDGET_MS, see routes/sources.ts), and only once the
    // folder is known to be free: a busy folder is a 409 either way, and it should not cost a source call.
    if (eligible.length) {
      if (jobBusy(s.folder)) return done(409, { error: 'busy', message: 'A download for that series is already running.' });
      if (opts.refresh !== false) await withTimeout(updateSeries(id, 0), REFRESH_BUDGET_MS).catch(() => {});
    }
    // The listing is the authorisation, exactly as POST /api/sources/fetch: what is fetched is the chosen
    // copy in it, and a number the sources no longer list has nothing to fetch.
    const listed = new Map((await q<{ number: number; title: string | null; source_id: string; status: string; chosen: SourceChapter; copies: ListingCopy[] }>(
      'SELECT number, title, source_id, status, chosen, copies FROM series_listing WHERE series_id = $1 AND number = ANY($2::real[])',
      [id, eligible.map((e) => e.number)],
    )).map((r) => [Number(r.number), r]));
    // A listing row's source_id is trusted only while the series still follows that source: the primary,
    // or a series_sources row. An unfollow drops the rows it carried (the route above), but a stale row --
    // one the next check has not rewritten yet, or one the unfollow's best-effort DELETE missed -- must
    // never authorise a download from a source the admin removed.
    // Reintroduce by dropping the `followed` check in stateOf: "a stale listing row never authorises a
    // source the series does not follow" in chapterActions.int.test.ts starts a download from it.
    const followed = new Set([
      ...(s.source_id ? [s.source_id as string] : []),
      ...(await q<{ source_id: string }>('SELECT source_id FROM series_sources WHERE series_id = $1', [id]).catch(() => [])).map((r) => r.source_id),
    ]);
    // The series' language rules (v0.62.0), read once and only when a blocked number needs explaining.
    let languageRules: Promise<LanguageRules> | null = null;
    const languageOf = () => (languageRules ??= languageRulesFor(id, [...followed]).catch((): LanguageRules => ({})));
    const sourceState = new Map<string, 'ok' | 'source_unavailable' | 'cooldown'>();
    const stateOf = async (sid: string) => {
      let st = sourceState.get(sid);
      if (st) return st;
      if (!followed.has(sid) || !getSource(sid) || await isDisabled(sid).catch(() => false)) st = 'source_unavailable';
      else if (await blockedNow(sid).catch(() => null)) st = 'cooldown';
      else st = 'ok';
      sourceState.set(sid, st);
      return st;
    };
    const todo: Array<{ row: typeof eligible[number]; chapter: SourceChapter & { pinned?: boolean } }> = [];
    for (const e of eligible) {
      const l = listed.get(e.number);
      const pick = pickOf.get(e.id);
      if (pick) {
        // The named copy, and nothing about the number's status: the blocklist is the sweep's rule, not
        // the admin's hand (the route comment). The source gate still applies to the copy's own source.
        const copy = l?.copies?.find((c) => c.source === pick.source && c.sourceId === pick.sourceId);
        if (!l || !copy) { skipped.push({ id: e.id, reason: 'not_listed' }); continue; }
        const st = await stateOf(copy.source);
        if (st !== 'ok') { skipped.push({ id: e.id, reason: st }); continue; }
        // Carry the explicit-pick marker into startDownloadJob. It is the downloader's authorization to
        // use this blocked copy, and also prevents downloadWithFallback from silently choosing another
        // version if the named copy fails.
        todo.push({ row: e, chapter: { ...copyToChapter(copy, { number: e.number, title: l.title }), pinned: true } });
        continue;
      }
      if (!l) { skipped.push({ id: e.id, reason: 'not_listed' }); continue; }
      if (l.status === 'blocked') {
        // v0.62.0: every copy in another language than the series' (lib/copyLanguage.ts) reads as its own reason.
        const language = (await languageOf()).inLanguage;
        const otherLanguage = !!language && l.copies.length > 0 && l.copies.every((c) => !language(c));
        skipped.push({ id: e.id, reason: otherLanguage ? 'other_language' : 'blocked_group' });
        continue;
      }
      const st = await stateOf(l.source_id);
      if (st !== 'ok') { skipped.push({ id: e.id, reason: st }); continue; }
      todo.push({ row: e, chapter: { ...l.chosen, source: l.source_id } });
    }
    if (!todo.length) {
      return done(409, { error: 'nothing_to_fetch', message: 'None of those chapters can be fetched again right now.', skipped });
    }
    if (jobBusy(s.folder)) return done(409, { error: 'busy', message: 'A download for that series is already running.' });
    const w = await allWritable([DL_ROOT]);
    if (!w.ok) return done(409, { error: 'refused', message: w.reason, fix: w.fix });
    // Reserve synchronously before the first set-aside rename. A bulk cleanup may have claimed the shared
    // folder while allWritable was awaited; in that case this refuses instead of renaming under its unlink.
    const claim = claimDownloadJob(s.folder, id);
    if (!claim) return done(409, { error: 'busy', message: 'Another task is changing that series.' });

    try {
      // `allWritable`, the listing refresh and the claim all awaited after the first validation. Check every path
      // again before the first set-aside rename so an intermediate symlink swapped in meanwhile cannot move a file
      // outside DL_ROOT. Nothing has been mutated yet, so one unsafe row refuses the whole replacement cleanly.
      for (const t of todo) {
        if (await realContainedPath(DL_ROOT, t.row.file) !== t.row.abs) {
          return done(409, { error: 'nothing_to_fetch', message: 'None of those chapters can be fetched again safely.',
            skipped: [...skipped, { id: t.row.id, reason: 'not_ours' }] });
        }
      }
      // The caller's last word before anything moves (lib/endorse.ts keeps the endorsed copy as a version here).
      if (opts.beforeSetAside) await opts.beforeSetAside(todo.map((t) => ({ id: t.row.id, number: t.row.number, abs: t.row.abs, source: t.chapter.source ?? '' })));
      // Set aside, mark, forget the failures -- per row, before the job starts, so the downloader's own
      // "already on disk" check does not skip the very file we are replacing.
      const byNumber = new Map(todo.map((t) => [t.row.number, t.row]));
      for (const t of todo) {
        await rename(t.row.abs, `${t.row.abs}${REFETCH_BAK}`).catch((e: any) => {
          // No file behind a tombstone is expected; anything else is worth a line, and the settle hook
          // below still handles it (the file is where it was, so the downloader skips and the mark clears).
          if (e?.code !== 'ENOENT') console.warn(`[refetch] could not set aside ${t.row.file}: ${e?.message || e}`);
        });
        // A live row is marked only while its old file is aside. A deliberate tombstone is already marked,
        // and overwriting its reason with NULL would make a failed restore lose deletion provenance.
        if (!t.row.pruned) await tombstoneBooks([t.row.id]);
      }
      await q('DELETE FROM chapter_failures WHERE series_id = $1 AND number = ANY($2::real[])',
        [id, todo.map((t) => t.row.number)]).catch(() => {});
      const picks = todo.filter((t) => pickOf.has(t.row.id)).map((t) => ({ bookId: t.row.id, number: t.row.number, source: t.chapter.source, sourceId: t.chapter.sourceId }));
      await logAudit('series.chapters_refetch', {
        userId: opts.by ?? undefined,
        detail: { id, title: s.title, bookIds: todo.map((t) => t.row.id), numbers: todo.map((t) => t.row.number), ...(picks.length ? { picks } : {}), skipped },
        req: opts.req,
      });
      const { total } = startDownloadJob({
        origin: 'refetch',
        folder: s.folder, title: s.title, seriesId: id,
        chapters: todo.map((t) => t.chapter).sort((a, b) => a.number - b.number),
        meta: { series: s.title, summary: s.summary, author: s.author, genres: s.genres, url: s.web, status: s.status },
        by: opts.by ?? undefined,
        // A Cancel (#82) settles every chapter the job did not reach as not landed, so each set-aside copy
        // below is put back exactly as for a chapter that failed.
        onSettled: async (ch, landed) => {
          const r = byNumber.get(ch.number);
          if (!r) return;
          const bak = `${r.abs}${REFETCH_BAK}`;
          if (landed) {
            await rm(bak, { force: true });
            // A copy picked by name is the admin's choice, and the nightly group upgrade (lib/repair.ts
            // stepGroups) leaves it alone; a plain Fetch again hands the choice back to the preferences.
            await q('UPDATE lib_books SET picked_at = $2 WHERE id = $1', [r.id, pickOf.has(r.id) ? new Date() : null]).catch(() => {});
            // This chapter's source and group now, not at the end of the job: a long endorse (bff lib/endorse.ts) runs for minutes, and
            // until the job's own stamp the page would name the source the file used to come from.
            await setBookMeta(s.folder, [{ number: ch.number, scanlator: ch.scanlator, source: ch.source, title: ch.title, chapterId: ch.sourceId }]).catch(() => {});
            if (opts.onLanded) await opts.onLanded(r.id).catch(() => {});
            return;
          }
          // Not landed: put the old copy back if it was set aside, and un-mark the row whenever a file is
          // there to read -- the restored one, or the original a failed rename left in place. A row that had
          // no file to begin with (a tombstone being fetched again) keeps its mark: the bytes are still gone.
          const exists = (p: string) => stat(p).then(() => true, () => false);
          if (await exists(bak) && !(await exists(r.abs))) await rename(bak, r.abs).catch(() => {});
          if (await exists(r.abs)) await q('UPDATE lib_books SET pruned_at = NULL WHERE id = $1', [r.id]).catch(() => {});
          if (opts.onFailed) await Promise.resolve(opts.onFailed(r.id)).catch(() => {});
        },
      }, claim);
      return done(200, { ok: true, started: true, folder: s.folder, total, skipped });
    } finally {
      releaseDownloadJobClaim(claim);
    }
}
