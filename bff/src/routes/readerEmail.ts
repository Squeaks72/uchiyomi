// Readers' own email (2026-11-18, lib/notify/readerEmail.ts): the reader's address and its confirmation, and the admin's choice of account.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin, userIdOf } from '../lib/auth';
import { one, q } from '../lib/db';
import { mailTo, newCode, readerAccount } from '../lib/notify/readerEmail';

const MAILBOX = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
/** At most this many emails a reader may cause in an hour: codes and tests together. */
const PER_HOUR = 5;

export default async function readerEmailRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** This reader's address, whether it is confirmed and on, and whether the server can send readers' mail at all. */
  app.get('/api/me/email', async (req) => {
    const u = await one<{ notify_email: string | null; verified: boolean; on: boolean; pending: boolean }>(
      `SELECT notify_email, notify_email_verified_at IS NOT NULL AS verified, notify_email_on AS on, notify_email_code IS NOT NULL AS pending
         FROM users WHERE id = $1`, [userIdOf(req)]);
    return { address: u?.notify_email ?? null, verified: !!u?.verified, on: u?.on !== false, pending: !!u?.pending, available: !!(await readerAccount()) };
  });

  // Count a sent email against the hour; false when the hour's allowance is used up.
  const spend = async (uid: string): Promise<boolean> => {
    const r = await one<{ ok: boolean }>(
      `UPDATE users SET notify_email_sends = CASE WHEN notify_email_code_at IS NULL OR notify_email_code_at < now() - interval '1 hour' THEN 1 ELSE notify_email_sends + 1 END,
              notify_email_code_at = CASE WHEN notify_email_code_at IS NULL OR notify_email_code_at < now() - interval '1 hour' THEN now() ELSE notify_email_code_at END
        WHERE id = $1 RETURNING notify_email_sends <= $2 AS ok`, [uid, PER_HOUR]);
    return !!r?.ok;
  };

  /** Set the address (unconfirmed) and mail it a six-digit code. */
  app.put('/api/me/email', async (req, reply) => {
    const b = z.object({ address: z.string().trim().max(254) }).safeParse(req.body);
    if (!b.success || !MAILBOX.test(b.data.address)) return reply.code(400).send({ error: 'bad_address', message: 'That is not an email address.' });
    if (!(await readerAccount())) return reply.code(409).send({ error: 'no_provider', message: 'Email is not set up on this server.' });
    const uid = userIdOf(req);
    if (!(await spend(uid))) return reply.code(429).send({ error: 'rate_limited', message: 'Too many emails this hour. Try again later.' });
    const code = newCode();
    await q('UPDATE users SET notify_email = $2, notify_email_verified_at = NULL, notify_email_code = $3 WHERE id = $1', [uid, b.data.address, code]);
    const res = await mailTo(b.data.address, `Your code: ${code}`, `Enter ${code} in Uchiyomi to confirm this address for notifications.\n\nIf you did not ask for this, ignore this email.`);
    if (!res.ok) return reply.code(502).send({ error: 'send_failed', message: 'The email could not be sent. Check the address, or ask the admin.' });
    return { sent: true };
  });

  /** Confirm the address with the code it was sent. */
  app.post('/api/me/email/verify', async (req, reply) => {
    const b = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_code' });
    const r = await q(`UPDATE users SET notify_email_verified_at = now(), notify_email_code = NULL
                        WHERE id = $1 AND notify_email_code = $2 RETURNING id`, [userIdOf(req), b.data.code]);
    if (!r.length) return reply.code(400).send({ error: 'wrong_code', message: 'That code is not right.' });
    return { verified: true };
  });

  /** A test email to the confirmed address. */
  app.post('/api/me/email/test', async (req, reply) => {
    const uid = userIdOf(req);
    const u = await one<{ notify_email: string | null; verified: boolean }>('SELECT notify_email, notify_email_verified_at IS NOT NULL AS verified FROM users WHERE id = $1', [uid]);
    if (!u?.notify_email || !u.verified) return reply.code(409).send({ error: 'not_confirmed' });
    if (!(await spend(uid))) return reply.code(429).send({ error: 'rate_limited', message: 'Too many emails this hour. Try again later.' });
    const res = await mailTo(u.notify_email, 'Uchiyomi test', 'This is a test: notifications will reach you at this address.');
    if (!res.ok) return reply.code(502).send({ error: 'send_failed', message: 'The email could not be sent. Ask the admin to check the email account.' });
    return { sent: true };
  });

  /** Email notifications on or off, the address kept. */
  app.put('/api/me/email/on', async (req, reply) => {
    const b = z.object({ on: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    await q('UPDATE users SET notify_email_on = $2 WHERE id = $1', [userIdOf(req), b.data.on]);
    return { on: b.data.on };
  });

  /** Forget the address. */
  app.delete('/api/me/email', async (req) => {
    await q('UPDATE users SET notify_email = NULL, notify_email_verified_at = NULL, notify_email_code = NULL WHERE id = $1', [userIdOf(req)]);
    return { ok: true };
  });

  /** Admin: which email target sends readers' mail, and the email targets to choose from. */
  app.get('/api/admin/reader-email', { preHandler: requireAdmin }, async () => {
    const s = await one<{ reader_email_target: string | null }>('SELECT reader_email_target FROM server_settings WHERE id = 1');
    // A server-wide email target, or one an admin owns (its SMTP account is the admin's to lend).
    const targets = await q<{ id: string; name: string; enabled: boolean }>(
      `SELECT t.id, t.name, t.enabled FROM notify_targets t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.kind = 'email' AND (t.user_id IS NULL OR u.role = 'admin') ORDER BY t.name`);
    const readers = await one<{ n: number }>('SELECT count(*)::int AS n FROM users WHERE notify_email_verified_at IS NOT NULL AND notify_email_on AND NOT disabled');
    return { targetId: s?.reader_email_target ?? null, targets, readers: readers?.n ?? 0 };
  });
  app.put('/api/admin/reader-email', { preHandler: requireAdmin }, async (req, reply) => {
    const b = z.object({ targetId: z.string().uuid().nullable() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    if (b.data.targetId && !(await one(`SELECT 1 FROM notify_targets WHERE id = $1 AND kind = 'email'`, [b.data.targetId]))) return reply.code(400).send({ error: 'not_email' });
    await q('UPDATE server_settings SET reader_email_target = $1 WHERE id = 1', [b.data.targetId]);
    return { targetId: b.data.targetId };
  });
}
