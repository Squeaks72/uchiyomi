// A reader's requests for series the library does not have (2026-11-18). Readers without "may download" never reach the sources: Discover
// shows them what the server already has and what AniList recommends, and anything missing becomes a request. The admin sees the
// requests -- one row per title, counting everyone who asked -- and adds the series the usual way, or declines with a note.
//
// A request is answered by itself once the library holds a series of that title (by its AniList entry, else by its folded title, English
// or romaji name included): reconcile() runs whenever either side looks, so "Find and add" in the add dialog is all an admin has to do.
// Every answer -- added or declined -- tells the reader by push.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticate, requireAdmin, userIdOf } from '../lib/auth';
import { one, q } from '../lib/db';
import { nameKey } from '../lib/onlineMatch';
import { browsableIds, viewCtxFor } from '../lib/visibility';
import { notifyAdmins, notifyUser } from '../lib/push';
import { emailUser } from '../lib/notify/readerEmail';

type Row = { id: string; user_id: string; title: string; title_key: string; anilist_id: number | null; cover_url: string | null; note: string | null;
  status: string; series_id: string | null; admin_note: string | null; created_at: Date; resolved_at: Date | null };

/** Answer every open request the library now holds: by AniList entry, else by any of the series' titles. Tells each reader. */
async function reconcile(): Promise<void> {
  const open = await q<Row>(`SELECT * FROM series_requests WHERE status = 'open'`).catch(() => [] as Row[]);
  if (!open.length) return;
  const series = await q<{ id: string; title: string; anilist_id: string | null; english: string | null; romaji: string | null }>(
    `SELECT s.id, s.title, o.anilist_id, o.english, o.romaji FROM lib_series s LEFT JOIN series_other_titles o ON o.series_id = s.id
      WHERE s.deleted_at IS NULL AND s.merged_into IS NULL`).catch(() => []);
  // Every series that could answer a request, by AniList entry and by folded title -- not just the first: the first may be one the
  // reader cannot see (a private library, above their age cap), and a request must never be answered with, or tell its reader about, that.
  const byAniList = new Map<string, string[]>();
  const byKey = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, id: string) => { const l = m.get(k); if (!l) m.set(k, [id]); else if (!l.includes(id)) l.push(id); };
  for (const s of series) {
    if (s.anilist_id) push(byAniList, String(s.anilist_id), s.id);
    for (const t of [s.title, s.english, s.romaji]) { const k = nameKey(t); if (k) push(byKey, k, s.id); }
  }
  const candidates = (r: Row): string[] => [...(r.anilist_id != null ? byAniList.get(String(r.anilist_id)) ?? [] : []), ...(byKey.get(r.title_key) ?? [])];
  const roles = new Map((await q<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = ANY($1)', [[...new Set(open.map((r) => r.user_id))]]).catch(() => [])).map((u) => [u.id, u.role]));
  for (const r of open) {
    const cand = candidates(r);
    if (!cand.length) continue;
    const allowed = await browsableIds(cand, await viewCtxFor(r.user_id, roles.get(r.user_id) ?? 'user')).catch(() => new Set<string>());
    const hit = cand.find((id) => allowed.has(id));
    if (!hit) continue;
    const done = await one<{ id: string }>(
      `UPDATE series_requests SET status = 'added', series_id = $2, resolved_at = now() WHERE id = $1 AND status = 'open' RETURNING id`, [r.id, hit]);
    if (done) {
      void notifyUser(r.user_id, r.title, 'Your request was added to the library.', `/series/?id=${hit}`, `request-${r.id}`).catch(() => false);
      void emailUser(r.user_id, `Added: ${r.title}`, `"${r.title}", which you asked for, is in the library now.`).catch(() => false);
    }
  }
}

const MAX_OPEN_PER_READER = 50;

const dto = (r: Row) => ({
  id: r.id, title: r.title, anilistId: r.anilist_id, coverUrl: r.cover_url, note: r.note, status: r.status, seriesId: r.series_id,
  adminNote: r.admin_note, createdAt: r.created_at, resolvedAt: r.resolved_at,
});

export default async function requestRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Ask for a series. One open request per reader per title: asking again returns the one already open. */
  app.post('/api/requests', async (req, reply) => {
    const b = z.object({
      title: z.string().trim().min(1).max(300),
      anilistId: z.number().int().positive().nullable().optional(),
      coverUrl: z.string().url().max(1000).nullable().optional(),
      note: z.string().trim().max(500).nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const uid = userIdOf(req);
    const key = nameKey(b.data.title);
    if (!key) return reply.code(400).send({ error: 'bad_request' });
    const mine = await one<Row>(
      `SELECT * FROM series_requests WHERE user_id = $1 AND status = 'open' AND (title_key = $2 OR ($3::int IS NOT NULL AND anilist_id = $3::int))`,
      [uid, key, b.data.anilistId ?? null]);
    if (mine) return { request: dto(mine), already: true };
    // Each new request tells every admin by push, so one account cannot make an unbounded number of them.
    const openCount = await one<{ n: number }>(`SELECT count(*)::int AS n FROM series_requests WHERE user_id = $1 AND status = 'open'`, [uid]);
    if ((openCount?.n ?? 0) >= MAX_OPEN_PER_READER) return reply.code(429).send({ error: 'too_many_requests', message: 'You have a lot of open requests already. Wait for some to be answered.' });
    const row = await one<Row>(
      `INSERT INTO series_requests (id, user_id, title, title_key, anilist_id, cover_url, note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [`rq_${randomUUID().replace(/-/g, '').slice(0, 20)}`, uid, b.data.title, key, b.data.anilistId ?? null, b.data.coverUrl ?? null, b.data.note || null]);
    await reconcile();
    const now = await one<Row>('SELECT * FROM series_requests WHERE id = $1', [row!.id]);
    if (now?.status === 'open') void notifyAdmins('New series request', b.data.title, '/discover/?requests=1', 'requests').catch(() => {});
    return { request: dto(now ?? row!), already: false };
  });

  /** This reader's requests, newest first: open ones and those answered in the last 60 days. */
  app.get('/api/requests/mine', async (req) => {
    await reconcile();
    const rows = await q<Row>(
      `SELECT * FROM series_requests WHERE user_id = $1 AND (status = 'open' OR resolved_at > now() - interval '60 days') ORDER BY created_at DESC`,
      [userIdOf(req)]);
    return { content: rows.map(dto) };
  });

  /** Withdraw an open request of one's own. */
  app.delete('/api/requests/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await q('DELETE FROM series_requests WHERE id = $1 AND user_id = $2 AND status = $3 RETURNING id', [id, userIdOf(req), 'open']);
    if (!r.length) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  /**
   * Admin: the open requests, one row per title (AniList entry, else folded title) with everyone who asked and their notes, oldest
   * first; and the answered ones of the last 30 days.
   */
  app.get('/api/admin/requests', { preHandler: requireAdmin }, async () => {
    await reconcile();
    const rows = await q<Row & { username: string }>(
      `SELECT r.*, u.username FROM series_requests r JOIN users u ON u.id = r.user_id
        WHERE r.status = 'open' OR r.resolved_at > now() - interval '30 days' ORDER BY r.created_at`);
    const groups = new Map<string, { key: string; title: string; anilistId: number | null; coverUrl: string | null; status: string; seriesId: string | null;
      ids: string[]; who: string[]; notes: { who: string; note: string }[]; firstAt: Date; adminNote: string | null }>();
    for (const r of rows) {
      const key = `${r.status}:${r.anilist_id != null ? `al${r.anilist_id}` : r.title_key}`;
      const g = groups.get(key) ?? { key, title: r.title, anilistId: r.anilist_id, coverUrl: r.cover_url, status: r.status, seriesId: r.series_id,
        ids: [], who: [], notes: [], firstAt: r.created_at, adminNote: r.admin_note };
      g.ids.push(r.id);
      if (!g.who.includes(r.username)) g.who.push(r.username);
      if (r.note) g.notes.push({ who: r.username, note: r.note });
      g.coverUrl ??= r.cover_url;
      groups.set(key, g);
    }
    const all = [...groups.values()];
    return { open: all.filter((g) => g.status === 'open'), answered: all.filter((g) => g.status !== 'open').reverse() };
  });

  /** Admin: decline requests (with an optional note the readers see), or mark them added to a series. Each reader is told. */
  app.post('/api/admin/requests/answer', { preHandler: requireAdmin }, async (req, reply) => {
    const b = z.object({
      ids: z.array(z.string().min(1).max(64)).min(1).max(200),
      status: z.enum(['added', 'declined']),
      seriesId: z.string().min(1).max(64).nullable().optional(),
      note: z.string().trim().max(500).nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const rows = await q<Row>(
      `UPDATE series_requests SET status = $2, series_id = $3, admin_note = $4, resolved_at = now() WHERE id = ANY($1) AND status = 'open' RETURNING *`,
      [b.data.ids, b.data.status, b.data.seriesId ?? null, b.data.note || null]);
    for (const r of rows) {
      const body = b.data.status === 'added' ? 'Your request was added to the library.'
        : `Your request was declined${b.data.note ? `: ${b.data.note}` : '.'}`;
      void notifyUser(r.user_id, r.title, body, r.series_id ? `/series/?id=${r.series_id}` : '/discover/', `request-${r.id}`).catch(() => false);
      void emailUser(r.user_id, `${b.data.status === 'added' ? 'Added' : 'Declined'}: ${r.title}`, `${r.title}: ${body}`).catch(() => false);
    }
    return { answered: rows.length };
  });
}
