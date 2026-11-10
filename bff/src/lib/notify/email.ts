/**
 * Email notification targets (fork): one message through the admin's own SMTP account, and what came of it in the
 * same closed set of reasons an HTTP target answers with (send.ts) -- never the server's reply text, which can quote
 * the address and the account back.
 *
 * TLS is never optional: `smtps://` speaks it from the first byte, `smtp://` must upgrade with STARTTLS or the send
 * fails. A mail server's certificate is checked like any other.
 */
import nodemailer from 'nodemailer';
import { smtpPort, smtpUrl, type EmailMessage, type TargetSecret } from './kinds';
import type { Reason, SendOptions, SendResult } from './send';

/** A nodemailer failure, read down to a reason. Only codes and status numbers are looked at; nothing is kept. */
export function emailReason(e: unknown): Reason {
  const err = e as { code?: string; responseCode?: number; command?: string } | null;
  const code = String(err?.code ?? '');
  const status = Number(err?.responseCode) || 0;
  if (code === 'EAUTH' || status === 535 || status === 534 || status === 530) return 'unauthorized';
  if (code === 'ETIMEDOUT' || /timeout/i.test(code)) return 'timeout';
  if (code === 'EDNS' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'ETLS' || /CERT|SSL|TLS/i.test(code)) return 'tls';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ECONNECTION' || code === 'ESOCKET') return 'unreachable';
  if (status === 421 || status === 450 || status === 451 || status === 452) return 'rate_limited';
  if (status >= 400 && status < 500) return 'server_error';
  if (status >= 500 || code === 'EENVELOPE' || code === 'EMESSAGE') return 'bad_response';
  return 'unreachable';
}

const RETRYABLE = new Set<Reason>(['timeout', 'refused', 'dns', 'unreachable', 'server_error', 'rate_limited']);

async function attempt(secret: TargetSecret, mail: EmailMessage, timeoutMs: number): Promise<SendResult> {
  const u = smtpUrl(secret.url);
  if (!u || !secret.from || !secret.to?.length) return { ok: false, status: null, reason: 'secret_unreadable' };
  const secure = u.protocol === 'smtps:';
  const transport = nodemailer.createTransport({
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: smtpPort(u),
    secure,
    requireTLS: !secure,
    auth: secret.username ? { user: secret.username, pass: secret.token ?? '' } : undefined,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    await transport.sendMail({ from: secret.from, to: secret.to, subject: mail.subject, text: mail.text, headers: { 'X-Mailer': 'Uchiyomi' } });
    return { ok: true, status: 250, reason: 'ok' };
  } catch (e) {
    return { ok: false, status: Number((e as { responseCode?: number })?.responseCode) || null, reason: emailReason(e) };
  } finally {
    transport.close();
  }
}

/** Send one email, at most twice (the second only on a network error or a temporary refusal). Never throws. */
export async function sendEmail(secret: TargetSecret, mail: EmailMessage, opts: SendOptions = {}): Promise<SendResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const first = await attempt(secret, mail, timeoutMs);
  if (first.ok || !opts.retry || !RETRYABLE.has(first.reason)) return first;
  await new Promise<void>((r) => setTimeout(r, opts.retryDelayMs ?? 30_000));
  return attempt(secret, mail, timeoutMs);
}
