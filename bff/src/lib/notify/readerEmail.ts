// Readers' own email (2026-11-18). An admin picks one of the server's email targets (an SMTP account, Admin -> Settings -> Notifications) to
// send readers' mail through; each reader gives an address in Profile -> Notifications and confirms it with a code sent to it -- so no one
// can make the server mail an address they do not read. Confirmed readers get a digest of new chapters of the series they subscribe to
// (the same rules as their push: their libraries and age cap, 18+ left out, "only my next chapter"), and the answers to their requests.
import { randomInt } from 'node:crypto';
import { q, one } from '../db';
import { browsableIds, viewCtxFor } from '../visibility';
import { wantsNews } from '../nextUp';
import { emailMessage, type TargetSecret } from './kinds';
import { sendEmail } from './email';
import { onDigest, openSecret, type Landed } from './index';
import type { SendResult } from './send';

/** The admin's account for readers' mail, as an email target's secret; null when none is chosen, it is off, or it will not open. */
export async function readerAccount(): Promise<{ secret: TargetSecret; name: string } | null> {
  const r = await one<{ kind: string; name: string; secret: string | null; enabled: boolean }>(
    `SELECT t.kind, t.name, t.secret, t.enabled FROM server_settings s JOIN notify_targets t ON t.id = s.reader_email_target WHERE s.id = 1`).catch(() => null);
  if (!r || r.kind !== 'email' || !r.enabled) return null;
  const secret = openSecret(r.secret);
  return secret ? { secret, name: r.name } : null;
}

async function serverTitle(): Promise<string> {
  const r = await one<{ server_name: string | null }>('SELECT server_name FROM server_settings WHERE id = 1').catch(() => null);
  return r?.server_name?.trim() || 'Uchiyomi';
}

/** One email to one address through the readers' account. */
export async function mailTo(address: string, subject: string, text: string): Promise<SendResult> {
  const acct = await readerAccount();
  if (!acct) return { ok: false, status: null, reason: 'secret_unreadable' };
  return sendEmail({ ...acct.secret, to: [address] }, { subject, text }, { retry: true });
}

/** One email to a reader whose address is confirmed and who has email on. False when nothing could be sent. */
export async function emailUser(userId: string, subject: string, text: string): Promise<boolean> {
  const u = await one<{ notify_email: string | null; ok: boolean }>(
    'SELECT notify_email, (notify_email_verified_at IS NOT NULL AND notify_email_on) AS ok FROM users WHERE id = $1 AND NOT disabled', [userId]).catch(() => null);
  if (!u?.ok || !u.notify_email) return false;
  return (await mailTo(u.notify_email, subject, text).catch(() => ({ ok: false }) as SendResult)).ok;
}

/** A fresh six-digit confirmation code. */
export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Each confirmed reader's digest for what a sweep landed: their subscribed series, by the push's rules. One email each. */
export async function readerDigest(landed: ReadonlyArray<Landed>): Promise<void> {
  const moved = landed.filter((s) => s.added > 0);
  if (!moved.length || !(await readerAccount())) return;
  const readers = await q<{ id: string; role: string; notify_email: string }>(
    `SELECT DISTINCT u.id, u.role, u.notify_email FROM users u JOIN series_subscriptions s ON s.user_id = u.id
      WHERE NOT u.disabled AND u.notify_email IS NOT NULL AND u.notify_email_verified_at IS NOT NULL AND u.notify_email_on
        AND s.series_id = ANY($1)`, [moved.map((s) => s.id)]).catch(() => []);
  const title = await serverTitle();
  for (const r of readers) {
    const subs = new Set((await q<{ series_id: string }>(
      'SELECT series_id FROM series_subscriptions WHERE user_id = $1 AND series_id = ANY($2)', [r.id, moved.map((s) => s.id)]).catch(() => [])).map((x) => x.series_id));
    let series = moved.filter((s) => subs.has(s.id));
    const keep: typeof series = [];
    for (const s of series) if (await wantsNews(r.id, s.id, s.numbers)) keep.push(s);
    series = keep;
    if (!series.length) continue;
    try {
      const ctx = { ...(await viewCtxFor(r.id, r.role)), hideAdultLibraries: true };
      const allowed = await browsableIds(series.map((s) => s.id), ctx);
      series = series.filter((s) => allowed.has(s.id));
    } catch { continue; }
    if (!series.length) continue;
    const count = series.reduce((n, s) => n + s.added, 0);
    const message = series.length === 1
      ? `${series[0].title}: ${count === 1 ? 'a new chapter' : `${count} new chapters`}`
      : `${count} new chapters in ${series.length} series you subscribe to`;
    const mail = emailMessage({ event: 'new_chapters', title, message, count, series: series.map((s) => ({ id: s.id, title: s.title, added: s.added })) });
    await mailTo(r.notify_email, mail.subject, mail.text).catch(() => null);
  }
}

onDigest(readerDigest);
