import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../lib/db';
import { content as komga } from '../lib/backend';
import { viewCtxFor, type ViewCtx, hideAdult } from '../lib/visibility';
import { authenticate, userIdOf, roleOf } from '../lib/auth';
import { TIER_ORDER, TIERS, modelReady, type Tier } from '../lib/panelDetect';
import { nextTier, panelRows, panelState, requestDetect, requestHarder } from '../lib/panelJob';

/**
 * Panel detection's reading and reviewing side (lib/panelJob.ts is the work): what was found for a chapter, a person's verdict on a
 * page (reject it, or pick another tier's answer), and asking for more -- detect a chapter or a series, or "try harder" on the pages
 * that were not good enough. Reading the results is for anyone who can open the chapter; changing anything is for an admin, because
 * the verdict is shared by every account.
 */
const tier = z.enum(['fast', 'careful', 'thorough']);

export default async function panelRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', async (req) => {
    (req as any).viewCtx = await viewCtxFor(userIdOf(req), roleOf(req), { hideAdult: hideAdult(req) });
  });
  const vc = (req: any): ViewCtx => req.viewCtx as ViewCtx;
  const adminOnly = (req: any, reply: any) => (roleOf(req) === 'admin' ? false : (reply.code(403).send({ error: 'forbidden' }), true));

  /** The chapter's page count when the caller may open it -- the same gate as the page list; 0 otherwise. */
  const openable = async (req: any, id: string): Promise<number> => {
    const pages = await komga.bookPages(vc(req), id);
    return Array.isArray(pages) ? pages.length : 0;
  };

  const status = async () => ({
    running: panelState.running, mode: panelState.mode, tier: panelState.tier, current: panelState.current, queued: panelState.queued,
    chapters: panelState.chapters, pages: panelState.pages, failed: panelState.failed, lastError: panelState.lastError,
    models: Object.fromEntries(await Promise.all(TIER_ORDER.map(async (t) => [t, { ready: await modelReady(t), megabytes: Math.round(TIERS[t].bytes / 1e6) }]))),
  });

  // What the detector is doing now, and which models are on disk (a tier's model downloads the first time it runs).
  app.get('/api/panels/status', async () => status());

  // One chapter's results, page by page, for the review screen.
  app.get('/api/books/:id/panels', async (req, reply) => {
    const { id } = req.params as { id: string };
    const total = await openable(req, id);
    if (!total) return reply.code(404).send({ error: 'not_found' });
    const rows = await panelRows(id);
    return {
      pages: total,
      detected: rows.length,
      items: rows.map((r) => ({ ...r, next: nextTier(r.candidates) })),
      status: await status(),
    };
  });

  // A person's word on one page: `rejected` puts it back to being read whole; `chosen` shows another tier's answer instead.
  app.put('/api/books/:id/pages/:n/panels', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const { id, n } = req.params as { id: string; n: string };
    const page = Number(n);
    const body = z.object({ rejected: z.boolean().optional(), chosen: tier.optional() }).parse(req.body ?? {});
    const total = await openable(req, id);
    if (!total) return reply.code(404).send({ error: 'not_found' });
    if (!Number.isInteger(page) || page < 1 || page > total) return reply.code(400).send({ error: 'bad_page' });
    const row = (await panelRows(id)).find((r) => r.page === page);
    if (!row) return reply.code(404).send({ error: 'not_detected' });
    if (body.chosen && !row.candidates[body.chosen]) return reply.code(400).send({ error: 'no_such_candidate' });
    // Choosing an answer is accepting one: it un-rejects. Rejecting alone keeps the choice, so un-rejecting brings it back.
    await q(
      `UPDATE page_panels SET chosen = COALESCE($3, chosen), rejected = COALESCE($4, CASE WHEN $3::text IS NOT NULL THEN false ELSE rejected END)
        WHERE book_id = $1 AND page = $2`,
      [id, page, body.chosen ?? null, body.rejected ?? null],
    );
    return { ok: true };
  });

  // Ask for a chapter to be (re)detected. `harder` runs, for each page, the next tier above what it has -- the answers are ADDED
  // beside the earlier ones. `pages` limits it; without `tier` the pass's own tier is used.
  app.post('/api/books/:id/panels', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = z.object({ tier: tier.optional(), pages: z.array(z.number().int().min(1)).max(2000).optional(), harder: z.boolean().optional(), force: z.boolean().optional() }).parse(req.body ?? {});
    if (!(await openable(req, id))) return reply.code(404).send({ error: 'not_found' });
    if (body.harder) return { ok: true, ...(await requestHarder(id, body.pages)) };
    const t: Tier = body.tier ?? 'fast';
    requestDetect([id], { tier: t, pages: body.pages, force: body.force, choose: true });
    return { ok: true, queued: { [t]: body.pages?.length ?? 'all' } };
  });

  // The same for a whole series: every chapter at a tier, or "try harder" on each chapter's rejected pages (`onlyRejected`) or all.
  app.post('/api/series/:id/panels', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = z.object({ tier: tier.optional(), harder: z.boolean().optional(), onlyRejected: z.boolean().optional(), force: z.boolean().optional() }).parse(req.body ?? {});
    const books = await q<{ id: string }>('SELECT id FROM lib_books WHERE series_id = $1 AND pruned_at IS NULL ORDER BY number', [id]);
    if (!books.length) return reply.code(404).send({ error: 'not_found' });
    if (body.harder) {
      let queued = 0, atTop = 0;
      for (const b of books) {
        const pages = body.onlyRejected ? (await panelRows(b.id)).filter((r) => r.rejected).map((r) => r.page) : undefined;
        if (pages && !pages.length) continue;
        const r = await requestHarder(b.id, pages);
        queued += Object.values(r.queued).reduce((a, b2) => a + b2, 0);
        atTop += r.atTop;
      }
      return { ok: true, queued, atTop };
    }
    requestDetect(books.map((b) => b.id), { tier: body.tier ?? 'fast', force: body.force, choose: true });
    return { ok: true, chapters: books.length };
  });

  // A series at a glance: each chapter's pages found, rejected, and how many panels they average -- the review screen's chapter list.
  app.get('/api/series/:id/panels', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const { id } = req.params as { id: string };
    const rows = await q<{ id: string; number: number; title: string | null; pages: number; found: number; rejected: number; tiers: string[] | null }>(
      `SELECT b.id, b.number, b.title, b.pages,
              count(p.page) FILTER (WHERE p.page >= 1)::int AS found,
              count(p.page) FILTER (WHERE p.rejected)::int AS rejected,
              (SELECT array_agg(DISTINCT k) FROM page_panels p2, jsonb_object_keys(p2.candidates) k WHERE p2.book_id = b.id) AS tiers
         FROM lib_books b LEFT JOIN page_panels p ON p.book_id = b.id
        WHERE b.series_id = $1 AND b.pruned_at IS NULL
        GROUP BY b.id ORDER BY b.number`, [id],
    );
    if (!rows.length) return reply.code(404).send({ error: 'not_found' });
    return { chapters: rows.map((r) => ({ ...r, tiers: r.tiers ?? [] })), status: await status() };
  });
}
