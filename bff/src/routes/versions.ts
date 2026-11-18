import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actsAsAdmin, authenticate, requireAdmin, roleOf, userIdOf } from '../lib/auth';
import { one, q } from '../lib/db';
import { viewCtxFor, hideAdult, seriesVisible, type ViewCtx } from '../lib/visibility';
import { seriesSourcesFor } from '../lib/seriesSources';
import { heldBySeries, mySource, setMySource, myBookPicks, setBookPick, COLORED_KEY, ENDORSED_KEY } from '../lib/bookVersionsRead';
import { visibleBookFile } from '../lib/visibility';
import { getSource } from '../lib/sources';
import { keepVersion } from '../lib/bookVersions';
import { keepAllVersions, keepingNow } from '../lib/versionKeeper';
import { logAudit } from '../lib/audit';
import { searchNovelSeries } from '../lib/bookorbitSync';
import { dropVersion, endorseChapter, endorsePlan, runEndorse } from '../lib/endorse';

/**
 * Every source's copy of a chapter (lib/bookVersionsRead.ts). A member chooses which source they read a series from -- their
 * reader, OPDS and Mihon are then served that source's copy of each chapter where one is kept -- and an admin says which
 * series keep every followed source's copy, or keeps one chapter's copy by hand.
 */
const vc = (req: FastifyRequest): ViewCtx => (req as any).viewCtx as ViewCtx;

export default async function versionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', async (req) => {
    (req as any).viewCtx = await viewCtxFor(userIdOf(req), roleOf(req), { hideAdult: hideAdult(req) });
  });

  /** What a series keeps, and this account's choice: the sources it follows, how many chapters of each are kept. */
  app.get('/api/series/:id/kept', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await seriesVisible(id, vc(req)))) return reply.code(404).send({ error: 'not_found' });
    const [sources, held, mine, picks, flag, endorsed] = await Promise.all([
      seriesSourcesFor(id),
      heldBySeries(id),
      mySource(userIdOf(req), id),
      myBookPicks(userIdOf(req), id),
      one<{ keep_versions: boolean; colored_source: string | null; colored_ref_source: string | null; colored_ref_title: string | null }>('SELECT keep_versions, colored_source, colored_ref_source, colored_ref_title FROM lib_series WHERE id = $1', [id]),
      q<{ number: number; source_id: string }>('SELECT number::float8 AS number, source_id FROM series_chapter_endorse WHERE series_id = $1', [id]).catch(() => []),
    ]);
    const counts = new Map<string, number>();
    for (const l of held.values()) for (const v of l) counts.set(v.sourceId, (counts.get(v.sourceId) ?? 0) + 1);
    return {
      mySource: mine,
      // This account's pick of one chapter's copy, by book id (ENDORSED_KEY: the endorsed file): the version rows' "Reading".
      picks,
      // An admin's endorsement of one chapter's copy, by chapter number, where it is not the main source's (lib/endorse.ts).
      endorsements: Object.fromEntries(endorsed.map((r) => [String(Number(r.number)), r.source_id])),
      keepVersions: flag?.keep_versions === true,
      coloredSource: flag?.colored_source ?? null,
      keeping: keepingNow(id),
      // A colored edition that is its own title on a source is a source of copies under the reserved key, listed after the followed ones.
      sources: [
        ...sources.filter((s) => s.registered).map((s) => ({ sourceId: s.sourceId, name: s.name, primary: s.primary, kept: counts.get(s.sourceId) ?? 0 })),
        ...(flag?.colored_source === COLORED_KEY && flag.colored_ref_source
          ? [{ sourceId: COLORED_KEY, name: 'Colored', primary: false, kept: counts.get(COLORED_KEY) ?? 0 }] : []),
      ],
      coloredRef: flag?.colored_source === COLORED_KEY && flag.colored_ref_source
        ? { source: flag.colored_ref_source, sourceName: getSource(flag.colored_ref_source)?.name ?? flag.colored_ref_source, title: flag.colored_ref_title ?? '' } : null,
      held: Object.fromEntries([...held.entries()].map(([n, l]) => [String(n), l])),
    };
  });

  /** This account's source for the series, or none (null: the endorsed copies). Any source the series follows. */
  app.put('/api/series/:id/my-source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ sourceId: z.string().min(1).max(200).nullable() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    if (!(await seriesVisible(id, vc(req)))) return reply.code(404).send({ error: 'not_found' });
    if (b.data.sourceId === COLORED_KEY) {
      if (!(await one('SELECT 1 FROM lib_series WHERE id = $1 AND colored_source = $2', [id, COLORED_KEY]))) return reply.code(400).send({ error: 'not_followed' });
    } else if (b.data.sourceId && !(await seriesSourcesFor(id)).some((s) => s.sourceId === b.data.sourceId)) return reply.code(400).send({ error: 'not_followed' });
    await setMySource(userIdOf(req), id, b.data.sourceId);
    return { mySource: b.data.sourceId };
  });

  /**
   * This account's copy of one chapter (the series page's version rows): a kept copy's source, ENDORSED_KEY for the endorsed file,
   * or null to follow the series' choice again. The reader, OPDS and Mihon then serve it (lib/bookVersionsRead.ts chosenVersion).
   */
  app.put('/api/books/:id/my-version', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ sourceId: z.string().min(1).max(200).nullable() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    if (!(await visibleBookFile(id, vc(req), { canonical: true }))) return reply.code(404).send({ error: 'not_found' });
    const pick = b.data.sourceId;
    if (pick && pick !== ENDORSED_KEY && !(await one('SELECT 1 FROM lib_book_versions WHERE book_id = $1 AND source_id = $2', [id, pick]))) {
      return reply.code(400).send({ error: 'not_kept' });
    }
    await setBookPick(userIdOf(req), id, pick);
    return { sourceId: pick };
  });

  /** Forget this account's per-chapter copy picks across a series (the Reading from menu's "Clear"): every chapter follows its choice again. */
  app.post('/api/series/:id/my-picks/clear', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await seriesVisible(id, vc(req)))) return reply.code(404).send({ error: 'not_found' });
    const r = await q<{ book_id: string }>(
      `DELETE FROM user_book_version p USING lib_books b WHERE p.book_id = b.id AND b.series_id = $2 AND p.user_id = $1 RETURNING p.book_id`,
      [userIdOf(req), id]);
    return { cleared: r.length };
  });

  /** Admin: keep every followed source's copy of this series' chapters (or stop). Turning it on starts the first pass. */
  app.put('/api/admin/series/:id/keep-versions', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ on: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const r = await q('UPDATE lib_series SET keep_versions = $2 WHERE id = $1 RETURNING id', [id, b.data.on]);
    if (!r.length) return reply.code(404).send({ error: 'not_found' });
    void logAudit('series.keep_versions', { userId: userIdOf(req), req, detail: { id, on: b.data.on } }).catch(() => {});
    if (b.data.on) void keepAllVersions(id, app.log);
    return { keepVersions: b.data.on };
  });

  /**
   * Admin: where the colored edition comes from, or none. Either a source the series follows (`sourceId`), or a title on any source -- one
   * the series already follows included -- as `{ ref: { source, sourceSeriesId, title } }`: the edition that is its own entry (MangaDex's
   * "Official Colored"). Its copies are always kept; readers switch to it themselves.
   */
  app.put('/api/admin/series/:id/colored-source', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      sourceId: z.string().min(1).max(200).nullable().optional(),
      ref: z.object({ source: z.string().min(1).max(200), sourceSeriesId: z.string().min(1).max(500), title: z.string().max(300).optional() }).optional(),
    }).refine((v) => v.sourceId !== undefined || v.ref !== undefined, { message: 'nothing named' }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    let set: { source: string | null; refSource: string | null; refSeries: string | null; refTitle: string | null };
    if (b.data.ref) {
      const adapter = getSource(b.data.ref.source);
      if (!adapter) return reply.code(400).send({ error: 'unknown_source' });
      // The pick is read once before it is saved: a title the source does not list, or lists with no chapters, is no edition.
      const listed = await adapter.listChapters(b.data.ref.sourceSeriesId).catch(() => null);
      if (!listed?.length) return reply.code(400).send({ error: 'nothing_listed', message: 'That title lists no chapters on its source.' });
      set = { source: COLORED_KEY, refSource: b.data.ref.source, refSeries: b.data.ref.sourceSeriesId, refTitle: b.data.ref.title ?? null };
    } else {
      const sourceId = b.data.sourceId ?? null;
      if (sourceId && !(await seriesSourcesFor(id)).some((s) => s.sourceId === sourceId)) return reply.code(400).send({ error: 'not_followed' });
      set = { source: sourceId, refSource: null, refSeries: null, refTitle: null };
    }
    const r = await q('UPDATE lib_series SET colored_source = $2, colored_ref_source = $3, colored_ref_series = $4, colored_ref_title = $5 WHERE id = $1 RETURNING id',
      [id, set.source, set.refSource, set.refSeries, set.refTitle]);
    if (!r.length) return reply.code(404).send({ error: 'not_found' });
    void logAudit('series.colored_source', { userId: userIdOf(req), req, detail: { id, source: set.source, ref: set.refSource ? `${set.refSource}:${set.refSeries}` : null } }).catch(() => {});
    if (set.source) void keepAllVersions(id, app.log);
    return { coloredSource: set.source };
  });

  /**
   * Download one source's copy of a chapter beside the endorsed one, for anyone who may download (the series page's version rows: a
   * copy a source lists and the server does not hold yet). The sources routes' rule: admins, and members whose canDownload is not off.
   * Answers once the copy is kept, so the caller can read it at once.
   */
  app.post('/api/series/:id/versions/fetch', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ number: z.number().finite().min(0).max(1e6), sourceId: z.string().min(1).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    if (!actsAsAdmin(req)) {
      const me = await one<{ perms: { canDownload?: boolean } | null }>('SELECT perms FROM users WHERE id = $1', [userIdOf(req)]).catch(() => null);
      if (!me || me.perms?.canDownload === false) return reply.code(403).send({ error: 'forbidden' });
    }
    if (!(await seriesVisible(id, vc(req)))) return reply.code(404).send({ error: 'not_found' });
    try {
      return { result: await keepVersion(id, b.data.number, b.data.sourceId) };
    } catch (e) {
      return reply.code(502).send({ error: 'fetch_failed', message: String((e as Error)?.message || e).slice(0, 200) });
    }
  });

  /**
   * Admin: endorse one source's copy of a chapter -- it becomes the chapter's file, for everyone who has not picked another -- or, with
   * `sourceId: null`, go back to the main source's copy. Applied at once (a refetch job); the copy endorsed until now is kept as a version.
   */
  app.put('/api/admin/series/:id/endorse', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ number: z.number().finite().min(0).max(1e6), sourceId: z.string().min(1).max(200).nullable() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    if (b.data.sourceId && !(await seriesSourcesFor(id)).some((s) => s.sourceId === b.data.sourceId)) return reply.code(400).send({ error: 'not_followed' });
    const r = await endorseChapter(id, b.data.number, b.data.sourceId, userIdOf(req));
    void logAudit('series.endorse', { userId: userIdOf(req), req, detail: { id, number: b.data.number, source: b.data.sourceId } }).catch(() => {});
    if (r.busy) return reply.code(409).send({ error: 'busy', message: 'A download for that series is already running.' });
    return { started: r.started, already: !!r.already, skipped: r.skipped };
  });

  /** Admin: endorse the main source's copy on every chapter of the series now (except chapters endorsed by hand). */
  app.post('/api/admin/series/:id/endorse-main', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const plan = await endorsePlan(id);
    await q('UPDATE lib_series SET endorse_pending = $2 WHERE id = $1', [id, plan.length > 0]);
    if (!plan.length) return { started: 0, remaining: 0 };
    const r = await runEndorse(id, plan, userIdOf(req));
    if (r.busy) return reply.code(409).send({ error: 'busy', message: 'A download for that series is already running.' });
    return { started: r.started, remaining: Math.max(0, plan.length - r.started) };
  });

  /** Admin: delete one kept (unendorsed) copy of a chapter. The endorsed file is never touched here. */
  app.post('/api/admin/series/:id/versions/drop', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ number: z.number().finite().min(0).max(1e6), sourceId: z.string().min(1).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const book = await one<{ id: string }>('SELECT id FROM lib_books WHERE series_id = $1 AND number = $2 AND pruned_at IS NULL ORDER BY file LIMIT 1', [id, b.data.number]);
    if (!book) return reply.code(404).send({ error: 'not_found' });
    const dropped = await dropVersion(book.id, b.data.sourceId);
    if (dropped) void logAudit('series.version_drop', { userId: userIdOf(req), req, detail: { id, number: b.data.number, source: b.data.sourceId } }).catch(() => {});
    return { dropped };
  });

  /**
   * Admin, server-wide: the unendorsed copies kept beside chapters (lib_book_versions), per series, with their size on disk. What the
   * Housekeeping cleanup offers to delete.
   */
  app.get('/api/admin/versions/summary', { preHandler: requireAdmin }, async () => {
    const rows = await q<{ id: string; title: string; copies: string; bytes: string | null; colored: string; picked: string; keep_versions: boolean }>(
      `SELECT s.id, s.title, s.keep_versions, count(*) AS copies, sum(v.size) AS bytes,
              count(*) FILTER (WHERE v.source_id = s.colored_source) AS colored,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_book_version p WHERE p.book_id = v.book_id AND p.source_id = v.source_id)
                                  OR EXISTS (SELECT 1 FROM user_series_source u WHERE u.series_id = s.id AND u.source_id = v.source_id)) AS picked
         FROM lib_book_versions v JOIN lib_books b ON b.id = v.book_id JOIN lib_series s ON s.id = b.series_id
        GROUP BY s.id ORDER BY sum(v.size) DESC NULLS LAST`);
    const content = rows.map((r) => ({ id: r.id, title: r.title, copies: Number(r.copies), bytes: Number(r.bytes ?? 0), colored: Number(r.colored), picked: Number(r.picked), keepVersions: r.keep_versions }));
    return { copies: content.reduce((a, r) => a + r.copies, 0), bytes: content.reduce((a, r) => a + r.bytes, 0), content };
  });

  /**
   * Admin, server-wide: delete unendorsed copies -- every series, or `seriesIds`. `keepColored` (default true) spares the colored
   * edition's copies, `keepPicked` (default true) those somebody reads (a chapter pick or a series source). The series cleaned stop
   * keeping every copy (keep_versions off), or the version keeper would fetch them all again.
   */
  app.post('/api/admin/versions/cleanup', { preHandler: requireAdmin }, async (req, reply) => {
    const b = z.object({ seriesIds: z.array(z.string().min(1).max(64)).max(5000).optional(), keepColored: z.boolean().optional(), keepPicked: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const keepColored = b.data.keepColored !== false;
    const keepPicked = b.data.keepPicked !== false;
    const rows = await q<{ book_id: string; source_id: string; series_id: string; size: string | null }>(
      `SELECT v.book_id, v.source_id, b.series_id, v.size FROM lib_book_versions v JOIN lib_books b ON b.id = v.book_id JOIN lib_series s ON s.id = b.series_id
        WHERE ($1::text[] IS NULL OR s.id = ANY($1::text[]))
          AND NOT ($2 AND v.source_id IS NOT DISTINCT FROM s.colored_source)
          AND NOT ($3 AND (EXISTS (SELECT 1 FROM user_book_version p WHERE p.book_id = v.book_id AND p.source_id = v.source_id)
                         OR EXISTS (SELECT 1 FROM user_series_source u WHERE u.series_id = s.id AND u.source_id = v.source_id)))`,
      [b.data.seriesIds ?? null, keepColored, keepPicked]);
    let deleted = 0, bytes = 0;
    for (const r of rows) {
      if (await dropVersion(r.book_id, r.source_id).catch(() => false)) { deleted++; bytes += Number(r.size ?? 0); }
    }
    const series = [...new Set(rows.map((r) => r.series_id))];
    if (series.length) await q('UPDATE lib_series SET keep_versions = false WHERE id = ANY($1::text[])', [series]);
    void logAudit('versions.cleanup', { userId: userIdOf(req), req, detail: { deleted, bytes, series: series.length, keepColored, keepPicked } }).catch(() => {});
    return { deleted, bytes, series: series.length };
  });

  /** Admin: keep one chapter's copy from one source. Answers when it is kept (or why it was not). */
  app.post('/api/admin/series/:id/versions/keep', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ number: z.number().finite().min(0).max(1e6), sourceId: z.string().min(1).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      return { result: await keepVersion(id, b.data.number, b.data.sourceId) };
    } catch (e) {
      return reply.code(502).send({ error: 'fetch_failed', message: String((e as Error)?.message || e).slice(0, 200) });
    }
  });
}
