/**
 * Files the library does not hold (lib/unmapped.ts): list them, map chapter archives to a series, bin them, and manage
 * the bin. Registered from inside routes/admin.ts after its `authenticate` + `requireAdmin` hooks, like rescan.ts, so
 * every route here is admin-only structurally.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { posix } from 'path';
import { q, one } from '../lib/db';
import { userIdOf } from '../lib/auth';
import { logAudit } from '../lib/audit';
import { DL_ROOT, persistScan } from '../lib/library';
import { allWritable } from '../lib/fsGuard';
import { claimWriterFolders } from '../lib/bulkNewest';
import { jobBusy } from './sources';
import { runsInside } from '../lib/updater';
import { listUnmapped, mapFiles, recycleFiles, listRecycled, restoreRecycled, purgeRecycled } from '../lib/unmapped';
import { visibleToAll } from '../lib/visibility';

/** A title as a folder name: no separators or characters a share refuses, no trailing dots. */
export const folderNameOf = (title: string): string =>
  title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');

const paths = z.array(z.string().min(1).max(1024)).min(1).max(500);

export default async function unmappedRoutes(app: FastifyInstance) {
  app.get('/api/admin/unmapped', async () => ({ ...(await listUnmapped()), bin: await listRecycled() }));

  // A short search for the "map to" picker: title or folder, live series only.
  app.get('/api/admin/unmapped/series', async (req) => {
    const term = String((req.query as { q?: string }).q ?? '').trim().slice(0, 100);
    if (!term) return { content: [] };
    return {
      content: await q<{ id: string; title: string; folder: string }>(
        `SELECT s.id, s.title, s.folder FROM lib_series s
          WHERE ${visibleToAll('s')} AND (s.title ILIKE $1 OR s.folder ILIKE $1)
          ORDER BY s.title LIMIT 20`, [`%${term.replace(/[%_\\]/g, '\\$&')}%`]),
    };
  });

  app.post('/api/admin/unmapped/map', async (req, reply) => {
    const b = z.object({
      seriesId: z.string().min(1).max(64).optional(),
      newSeries: z.object({ title: z.string().min(1).max(200), folder: z.string().max(400).optional() }).optional(),
      items: z.array(z.object({ path: z.string().min(1).max(1024), number: z.number().finite().min(-1000).max(100000) })).min(1).max(500),
    }).refine((x) => !!x.seriesId !== !!x.newSeries).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });

    let folder: string;
    let id: string | null = null;
    if (b.data.seriesId) {
      const row = await one<{ id: string; folder: string }>(
        `SELECT s.id, s.folder FROM lib_series s WHERE s.id = $1 AND ${visibleToAll('s')}`, [b.data.seriesId]);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      ({ id, folder } = row);
    } else {
      const typed = (b.data.newSeries!.folder ?? '').split('/').map(folderNameOf).filter(Boolean).join('/');
      folder = typed || posix.join('Imported', folderNameOf(b.data.newSeries!.title));
      if (!folderNameOf(b.data.newSeries!.title) || folder.split('/').some((s) => s === '..' || s === '.')) {
        return reply.code(400).send({ error: 'bad_request', message: 'Give the series a title that can be a folder name.' });
      }
      const taken = await one<{ id: string; title: string }>('SELECT id, title FROM lib_series WHERE folder = $1', [folder]);
      if (taken) return reply.code(409).send({ error: 'exists', message: `"${taken.title}" already uses that folder; map the files to it instead.`, seriesId: taken.id });
    }

    const w = await allWritable([DL_ROOT]);
    if (!w.ok) return reply.code(503).send({ error: 'not_writable', message: w.reason, fix: w.fix });
    const claim = claimWriterFolders([folder], jobBusy, () => !!id && runsInside(id) > 0);
    if (!claim) return reply.code(409).send({ error: 'busy', message: 'Another task is changing that series right now. Try again when it has finished.' });
    try {
      const results = await mapFiles(folder, b.data.items);
      const moved = results.filter((r) => r.ok).length;
      if (moved) {
        await persistScan();
        if (!id) id = (await one<{ id: string }>('SELECT id FROM lib_series WHERE folder = $1', [folder]))?.id ?? null;
        await logAudit('unmapped.map', { userId: userIdOf(req), detail: { seriesId: id, folder, moved, refused: results.length - moved }, req });
      }
      return { results, moved, seriesId: id, folder };
    } finally { claim.release(); }
  });

  app.post('/api/admin/unmapped/delete', async (req, reply) => {
    const b = z.object({ paths }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const results = await recycleFiles(b.data.paths, userIdOf(req) ?? null);
    const moved = results.filter((r) => r.ok).length;
    if (moved) await logAudit('unmapped.delete', { userId: userIdOf(req), detail: { files: moved, refused: results.length - moved }, req });
    return { results, moved };
  });

  app.post('/api/admin/unmapped/restore', async (req, reply) => {
    const b = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const results = await restoreRecycled(b.data.ids);
    return { results, restored: results.filter((r) => r.ok).length };
  });

  // Empties the bin now (all of it, or the ids given) instead of waiting for the time limit.
  app.post('/api/admin/unmapped/purge', async (req, reply) => {
    const b = z.object({ ids: z.array(z.string().min(1).max(64)).max(500).optional() }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const ids = b.data.ids ?? (await q<{ id: string }>('SELECT id FROM unmapped_recycle')).map((r) => r.id);
    const purged = ids.length ? await purgeRecycled(ids) : 0;
    if (purged) await logAudit('unmapped.purge', { userId: userIdOf(req), detail: { purged }, req });
    return { purged };
  });
}
