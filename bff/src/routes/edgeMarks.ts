// Admin -> Health: the strips sources stamp on their pages (lib/edgeMarks.ts), by source -- how many chapters, an example of each, the
// switch that cuts them off as pages are served, and the chapters where another source's kept copy is clean, to endorse instead.
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { authenticate, requireAdmin, userIdOf } from '../lib/auth';
import { one, q } from '../lib/db';
import { cbzPageAt } from '../lib/library';
import { sourceLabel } from '../lib/health';
import { edgeMarksRemaining, emState, forgetTrimSources, runEdgeMarks, type EdgeMark } from '../lib/edgeMarks';
import { endorsePlan, runEndorse } from '../lib/endorse';
import { logAudit } from '../lib/audit';

interface MarkRow { id: string; path: string; book_id: string; source_id: string; is_version: boolean; marks: EdgeMark[]; series_id: string | null; title: string | null; number: number | null }

export default async function edgeMarkRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** The report: each source with stamped chapters, most first, with up to six examples; the pass's progress; the clean copies. */
  app.get('/api/admin/edge-marks', { preHandler: requireAdmin }, async () => {
    const totals = await q<{ source_id: string; checked: string; marked: string; versions: string }>(
      `SELECT source_id, count(*)::text checked, count(*) FILTER (WHERE marks <> '[]'::jsonb)::text marked,
              count(*) FILTER (WHERE marks <> '[]'::jsonb AND is_version)::text versions
         FROM edge_marks WHERE source_id IS NOT NULL GROUP BY source_id`);
    const marked = totals.filter((t) => Number(t.marked) > 0).map((t) => t.source_id);
    const names = new Map((await q<{ id: string; name: string }>(`SELECT 'sw:' || source_id AS id, name FROM suwayomi_sources`).catch(() => [])).map((r) => [r.id, r.name]));
    const trimmed = new Set((await q<{ source_id: string }>('SELECT source_id FROM source_trim')).map((r) => r.source_id));
    const examples = marked.length ? await q<MarkRow>(
      `SELECT * FROM (
         SELECT e.id::text, e.path, e.book_id, e.source_id, e.is_version, e.marks, b.series_id, s.title, b.number::float8 AS number,
                row_number() OVER (PARTITION BY e.source_id ORDER BY e.is_version, random()) AS rn
           FROM edge_marks e LEFT JOIN lib_books b ON b.id = e.book_id LEFT JOIN lib_series s ON s.id = b.series_id
          WHERE e.source_id = ANY($1) AND e.marks <> '[]'::jsonb) t WHERE rn <= 6`, [marked]) : [];
    const sources = totals.filter((t) => Number(t.marked) > 0).map((t) => {
      const ex = examples.filter((e) => e.source_id === t.source_id);
      const edges = [...new Set(ex.flatMap((e) => e.marks.map((m) => m.edge)))];
      return {
        sourceId: t.source_id, name: sourceLabel(t.source_id, names.get(t.source_id)), checked: Number(t.checked), marked: Number(t.marked),
        versions: Number(t.versions), edges, trim: trimmed.has(t.source_id),
        examples: ex.map((e) => ({ id: e.id, bookId: e.book_id, seriesId: e.series_id, title: e.title, number: e.number, version: e.is_version,
          marks: e.marks.map((m) => ({ edge: m.edge, depth: m.depth, width: m.width })) })),
      };
    }).sort((a, b) => b.marked - a.marked);
    // Chapters whose endorsed copy is stamped while a kept copy from another source is clean.
    const clean = await q<{ series_id: string; title: string; n: string; numbers: number[] }>(
      `SELECT b.series_id, s.title, count(DISTINCT b.id)::text n, array_agg(DISTINCT b.number::float8 ORDER BY b.number::float8) numbers
         FROM edge_marks e JOIN lib_books b ON b.id = e.book_id AND NOT e.is_version JOIN lib_series s ON s.id = b.series_id
        WHERE e.marks <> '[]'::jsonb AND b.pruned_at IS NULL
          AND EXISTS (SELECT 1 FROM edge_marks c WHERE c.book_id = b.id AND c.is_version AND c.marks = '[]'::jsonb)
        GROUP BY b.series_id, s.title ORDER BY count(*) DESC LIMIT 50`);
    const checked = await one<{ n: string }>('SELECT count(*)::text n FROM edge_marks');
    return {
      progress: { ...emState, checked: Number(checked?.n ?? 0), remaining: emState.running ? emState.remaining : await edgeMarksRemaining() },
      sources,
      cleanCopies: clean.map((c) => ({ seriesId: c.series_id, title: c.title, chapters: Number(c.n), numbers: c.numbers.slice(0, 200) })),
    };
  });

  /** Look now, rather than at the next six-hourly pass. */
  app.post('/api/admin/edge-marks/run', { preHandler: requireAdmin }, async () => {
    if (!emState.running) void runEdgeMarks().catch(() => {});
    return { started: true };
  });

  /** Cut a source's strips off its pages as they are served, or stop (the files are never changed). */
  app.put('/api/admin/edge-marks/trim', { preHandler: requireAdmin }, async (req, reply) => {
    const b = z.object({ sourceId: z.string().min(1).max(200), on: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    if (b.data.on) await q('INSERT INTO source_trim (source_id) VALUES ($1) ON CONFLICT DO NOTHING', [b.data.sourceId]);
    else await q('DELETE FROM source_trim WHERE source_id = $1', [b.data.sourceId]);
    forgetTrimSources();
    void logAudit('source.trim', { userId: userIdOf(req), req, detail: b.data }).catch(() => {});
    return { ok: true };
  });

  /** Endorse the clean kept copy of each stamped chapter of a series. */
  app.post('/api/admin/edge-marks/endorse-clean', { preHandler: requireAdmin }, async (req, reply) => {
    const b = z.object({ seriesId: z.string().min(1).max(64) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const picks = await q<{ number: number; source_id: string }>(
      `SELECT DISTINCT ON (b.number) b.number::float8 AS number, c.source_id
         FROM edge_marks e JOIN lib_books b ON b.id = e.book_id AND NOT e.is_version
         JOIN edge_marks c ON c.book_id = b.id AND c.is_version AND c.marks = '[]'::jsonb AND c.source_id IS NOT NULL
        WHERE b.series_id = $1 AND b.pruned_at IS NULL AND e.marks <> '[]'::jsonb ORDER BY b.number, c.checked_at DESC`, [b.data.seriesId]);
    if (!picks.length) return { started: 0 };
    const by = userIdOf(req);
    for (const p of picks) {
      await q(`INSERT INTO series_chapter_endorse (series_id, number, source_id, set_by) VALUES ($1, $2, $3, $4)
               ON CONFLICT (series_id, number) DO UPDATE SET source_id = EXCLUDED.source_id, set_by = EXCLUDED.set_by, set_at = now()`,
        [b.data.seriesId, p.number, p.source_id, by]);
    }
    const plan = await endorsePlan(b.data.seriesId, { numbers: picks.map((p) => p.number) });
    const r = plan.length ? await runEndorse(b.data.seriesId, plan, by) : { started: 0, skipped: [] };
    void logAudit('series.endorse', { userId: by, req, detail: { id: b.data.seriesId, clean: picks.length } }).catch(() => {});
    if ('busy' in r && r.busy) return reply.code(409).send({ error: 'busy', message: 'A download for that series is already running.' });
    return { started: r.started };
  });

  /** An example: the stamped edge of one of the chapter's pages (the third, else the first), as it is in the file. */
  app.get('/api/admin/edge-marks/:id/strip', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^\d{1,18}$/.test(id)) return reply.code(404).send({ error: 'not_found' });
    const row = await one<{ path: string; marks: EdgeMark[] }>('SELECT path, marks FROM edge_marks WHERE id = $1', [id]);
    const mark = row?.marks[0];
    if (!row || !mark) return reply.code(404).send({ error: 'not_found' });
    for (const i of [2, 1, 3, 0, 4, 5]) {
      const page = await cbzPageAt(row.path, i).catch(() => null);
      if (!page) continue;
      const m = await sharp(page.bytes).metadata().catch(() => null);
      if (!m?.width || !m.height || m.width !== mark.width) continue;
      const h = Math.min(m.height, Math.round(mark.depth * 2.5));
      const buf = await sharp(page.bytes).extract({ left: 0, top: mark.edge === 'bottom' ? m.height - h : 0, width: m.width, height: h })
        .resize({ width: Math.min(m.width, 900), withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      return reply.header('content-type', 'image/webp').header('cache-control', 'private, max-age=3600').send(buf);
    }
    return reply.code(404).send({ error: 'not_found' });
  });
}
