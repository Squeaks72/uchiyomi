/**
 * Admin → Settings → BookOrbit sync (lib/bookorbitSync.ts). Registered from inside routes/admin.ts after its
 * `authenticate` + `requireAdmin` hooks, so every route is admin-only. Secrets are written, never read back.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userIdOf } from '../lib/auth';
import { logAudit } from '../lib/audit';
import { getLink, saveLink, testLink, runSync, syncRunning } from '../lib/bookorbitSync';

async function view() {
  const l = await getLink();
  return {
    configured: !!l, enabled: !!l?.enabled, url: l?.url ?? '', username: l?.username ?? '', pathPrefix: l?.path_prefix ?? '/books/manga',
    hasPassword: !!l?.password, hasDb: !!l?.db_url, lastRun: l?.last_run ?? null, lastResult: l?.last_result ?? null,
    lastError: (l as any)?.last_error ?? null, running: syncRunning(),
  };
}

export default async function bookorbitSyncRoutes(app: FastifyInstance) {
  app.get('/api/admin/bookorbit-sync', async () => view());

  app.put('/api/admin/bookorbit-sync', async (req, reply) => {
    const b = z.object({
      enabled: z.boolean().optional(), url: z.string().max(300).optional(), username: z.string().max(100).optional(),
      password: z.string().max(1024).optional(), dbUrl: z.string().max(500).optional(), pathPrefix: z.string().max(300).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    if (b.data.url && !/^https?:\/\//i.test(b.data.url.trim())) return reply.code(400).send({ error: 'bad_request', message: 'The address must start with http:// or https://.' });
    if (b.data.dbUrl && !/^postgres(ql)?:\/\//i.test(b.data.dbUrl.trim())) return reply.code(400).send({ error: 'bad_request', message: 'The database address must start with postgres://.' });
    await saveLink(userIdOf(req)!, b.data);
    await logAudit('bookorbit_sync.settings', { userId: userIdOf(req), detail: { fields: Object.keys(b.data).filter((k) => k !== 'password' && k !== 'dbUrl'), enabled: b.data.enabled }, req });
    return view();
  });

  app.post('/api/admin/bookorbit-sync/test', async (_req, reply) => {
    const l = await getLink();
    if (!l || !l.url || !l.username || !l.password || !l.db_url) return reply.code(400).send({ ok: false, message: 'Fill in the address, login and database first.' });
    return testLink(l);
  });

  // A full look at every chapter both sides have a place in, now.
  app.post('/api/admin/bookorbit-sync/run', async (req, reply) => {
    const l = await getLink();
    if (!l?.enabled) return reply.code(400).send({ error: 'disabled', message: 'Switch the sync on first.' });
    const r = await runSync({ full: true });
    await logAudit('bookorbit_sync.run', { userId: userIdOf(req), detail: r, req });
    return r ?? { busy: true };
  });
}
