import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin, roleOf, userIdOf } from '../lib/auth';
import { one, q } from '../lib/db';
import { viewCtxFor, hideAdult, seriesVisible, type ViewCtx } from '../lib/visibility';
import { seriesSourcesFor } from '../lib/seriesSources';
import { heldBySeries, mySource, setMySource } from '../lib/bookVersionsRead';
import { keepVersion } from '../lib/bookVersions';
import { keepAllVersions, keepingNow } from '../lib/versionKeeper';
import { logAudit } from '../lib/audit';

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
    const [sources, held, mine, flag] = await Promise.all([
      seriesSourcesFor(id),
      heldBySeries(id),
      mySource(userIdOf(req), id),
      one<{ keep_versions: boolean; colored_source: string | null }>('SELECT keep_versions, colored_source FROM lib_series WHERE id = $1', [id]),
    ]);
    const counts = new Map<string, number>();
    for (const l of held.values()) for (const v of l) counts.set(v.sourceId, (counts.get(v.sourceId) ?? 0) + 1);
    return {
      mySource: mine,
      keepVersions: flag?.keep_versions === true,
      coloredSource: flag?.colored_source ?? null,
      keeping: keepingNow(id),
      sources: sources.filter((s) => s.registered).map((s) => ({ sourceId: s.sourceId, name: s.name, primary: s.primary, kept: counts.get(s.sourceId) ?? 0 })),
      held: Object.fromEntries([...held.entries()].map(([n, l]) => [String(n), l])),
    };
  });

  /** This account's source for the series, or none (null: the endorsed copies). Any source the series follows. */
  app.put('/api/series/:id/my-source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ sourceId: z.string().min(1).max(200).nullable() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    if (!(await seriesVisible(id, vc(req)))) return reply.code(404).send({ error: 'not_found' });
    if (b.data.sourceId && !(await seriesSourcesFor(id)).some((s) => s.sourceId === b.data.sourceId)) return reply.code(400).send({ error: 'not_followed' });
    await setMySource(userIdOf(req), id, b.data.sourceId);
    return { mySource: b.data.sourceId };
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

  /** Admin: which followed source carries the colored edition (or none). Its copies are always kept; readers switch to it themselves. */
  app.put('/api/admin/series/:id/colored-source', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ sourceId: z.string().min(1).max(200).nullable() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    if (b.data.sourceId && !(await seriesSourcesFor(id)).some((s) => s.sourceId === b.data.sourceId)) return reply.code(400).send({ error: 'not_followed' });
    const r = await q('UPDATE lib_series SET colored_source = $2 WHERE id = $1 RETURNING id', [id, b.data.sourceId]);
    if (!r.length) return reply.code(404).send({ error: 'not_found' });
    void logAudit('series.colored_source', { userId: userIdOf(req), req, detail: { id, source: b.data.sourceId } }).catch(() => {});
    if (b.data.sourceId) void keepAllVersions(id, app.log);
    return { coloredSource: b.data.sourceId };
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
