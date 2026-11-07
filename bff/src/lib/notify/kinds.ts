/**
 * The four kinds of notification target (v0.43.0, #70), each as two pure functions: `validateTarget` turns
 * what an admin typed into what is stored, `buildRequest` turns what is stored into one POST.
 *
 * METHOD, HEADERS AND BODY ARE OURS, NEVER THE ADMIN'S. A target configures an address, a token, a Home
 * Assistant service or an ntfy topic, and a message template -- never the HTTP method, never an arbitrary
 * header, never a raw body. That is what keeps this from being a general-purpose HTTP client behind an admin
 * button, and it is why guard.ts can afford to allow private addresses at all.
 *
 * Declined, with the reasons given on the issue: Telegram (a chat id obtained by hand through getUpdates, and
 * the bot token sits in the URL path) and SMTP (a new dependency, server/port/TLS/auth configuration, and the
 * largest support burden in self-hosted software). The generic webhook reaches both through a bridge.
 *
 * Fork: SMTP after all, as `email` -- the owner's server already has a mail account it sends from. It is not an
 * HTTP POST, so it has no `buildRequest`; `emailMessage` shapes it and lib/notify/email.ts sends it. The address is
 * `smtps://host:465` (TLS from the first byte) or `smtp://host:587` (STARTTLS, required); the password is the token.
 */
import { effectivePort, refusal, safeUrl } from './guard';

export const KINDS = ['webhook', 'home_assistant', 'ntfy', 'discord', 'email'] as const;
export type Kind = (typeof KINDS)[number];
export const EVENTS = ['new_chapters', 'health', 'volume_complete'] as const;
export type NotifyEvent = (typeof EVENTS)[number];

/** Sealed into notify_targets.secret: every address and every token. */
export interface TargetSecret { url: string; token?: string; topic?: string; /** email */ username?: string; from?: string; to?: string[] }
/** notify_targets.config: nothing here lets anyone post to the target. */
export interface TargetConfig { display: string; service?: string; hasToken?: boolean }

/** What one notification says, before a kind shapes it. */
export interface Message {
  event: NotifyEvent | 'test';
  title: string;
  message: string;
  count: number;
  series: Array<{ id: string; title: string; added: number }>;
}

export interface OutboundRequest { url: string; headers: Record<string, string>; body: string }

export type Invalid = { ok: false; error: string; message: string };
export type Validated = { ok: true; secret: TargetSecret; config: TargetConfig } | Invalid;

/** What an admin typed for one target. Every field is optional here; each kind says which it needs. */
export interface TargetInput { url?: string; token?: string | null; topic?: string; service?: string; username?: string; from?: string; to?: string }

const bad = (error: string, message: string): Invalid => ({ ok: false, error, message });
const BAD_URL = bad('bad_url', 'That address is not a valid http(s) URL');

/** Home Assistant's `domain.service`, e.g. notify.mobile_app_pixel. Lower case, digits, underscores. */
export const HA_SERVICE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
/** ntfy's own topic grammar. */
export const NTFY_TOPIC = /^[A-Za-z0-9_-]{1,64}$/;
const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);
const DISCORD_PATH = /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/;
/** A bearer token is visible ASCII: anything else is either a paste accident or a header injection. */
const TOKEN = /^[\x21-\x7e]{1,4096}$/;

/**
 * The address as the admin panel may show it: scheme, host and port, and "/…" when there is more.
 * Never the path -- a Discord or Home Assistant webhook, an n8n trigger, an ntfy topic all carry their
 * secret there -- and never a query string.
 */
export function maskUrl(u: URL): string {
  const more = (u.pathname && u.pathname !== '/') || u.search ? '/…' : '';
  return `${u.protocol}//${u.host}${more}`;
}

/** The address, checked, and refused with a fixed sentence (never an echo of it). */
function address(raw: string | undefined): URL | Invalid {
  const u = safeUrl(raw);
  if (!u) return BAD_URL;
  const why = refusal(u);
  if (why === 'blocked') return bad('blocked_address', 'That address belongs to a cloud metadata service and is refused');
  if (why === 'self') return bad('self_target', 'That address is this server itself');
  return u;
}

function token(raw: string | null | undefined, required: boolean): string | undefined | Invalid {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t) return required ? bad('token_required', 'This kind of target needs an access token') : undefined;
  if (!TOKEN.test(t)) return bad('bad_token', 'The token can only contain visible characters, with no spaces');
  return t;
}

/** One mailbox, plainly: no display name, no comments, no second address hiding behind a comma or a newline. */
export const MAILBOX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
/** The most recipients one email target may have. */
export const MAX_RECIPIENTS = 5;

/** An SMTP server address: `smtps://host[:port]` or `smtp://host[:port]`, nothing after the port. */
export function smtpUrl(raw: string | undefined): URL | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 300) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') return null;
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return null;
  if (!u.hostname || !/^[A-Za-z0-9.-]{1,253}$|^\[[0-9a-fA-F:.]+\]$/.test(u.hostname)) return null;
  return u;
}
export const smtpPort = (u: URL): number => Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587);
/** Where an email target sends from, for the "a credential never follows the address" rule: host and port. */
export const smtpEndpoint = (raw: string | undefined): string | null => {
  const u = smtpUrl(raw);
  return u ? `${u.protocol}//${u.hostname.toLowerCase()}:${smtpPort(u)}` : null;
};

const isInvalid = (v: unknown): v is Invalid => !!v && typeof v === 'object' && (v as Invalid).ok === false;

/**
 * Check what an admin typed for a target of this kind, and split it into what is sealed and what is shown.
 * Every refusal is a fixed sentence; nothing typed is ever quoted back.
 */
export function validateTarget(kind: Kind, input: TargetInput): Validated {
  switch (kind) {
    case 'webhook': {
      const u = address(input.url); if (isInvalid(u)) return u;
      const t = token(input.token, false); if (isInvalid(t)) return t;
      return { ok: true, secret: { url: u.href, ...(t ? { token: t } : {}) }, config: { display: maskUrl(u), hasToken: !!t } };
    }
    case 'home_assistant': {
      const u = address(input.url); if (isInvalid(u)) return u;
      const t = token(input.token, true); if (isInvalid(t)) return t;
      const service = (input.service ?? '').trim();
      if (!HA_SERVICE.test(service)) return bad('bad_service', 'The service looks like notify.mobile_app_your_phone');
      // Only the origin is kept: the request path is rebuilt from it and the validated service name.
      return { ok: true, secret: { url: u.origin, token: t as string }, config: { display: u.origin, service, hasToken: true } };
    }
    case 'ntfy': {
      const u = address(input.url || 'https://ntfy.sh'); if (isInvalid(u)) return u;
      const t = token(input.token, false); if (isInvalid(t)) return t;
      const topic = (input.topic ?? '').trim();
      if (!NTFY_TOPIC.test(topic)) return bad('bad_topic', 'A topic is 1 to 64 letters, digits, - or _');
      const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
      // On a public ntfy server the topic IS the password -- anyone who knows it can read the stream -- so it
      // is sealed with the token and the display shows the server alone.
      return { ok: true, secret: { url: base, topic, ...(t ? { token: t } : {}) }, config: { display: `${maskUrl(u)}`, hasToken: !!t } };
    }
    case 'discord': {
      const u = address(input.url); if (isInvalid(u)) return u;
      if (u.protocol !== 'https:' || !DISCORD_HOSTS.has(u.hostname.toLowerCase()) || effectivePort(u) !== 443 || !DISCORD_PATH.test(u.pathname)) {
        return bad('bad_discord_url', 'That is not a Discord webhook address (Server Settings → Integrations → Webhooks → Copy Webhook URL)');
      }
      return { ok: true, secret: { url: `${u.origin}${u.pathname}` }, config: { display: maskUrl(u) } };
    }
    case 'email': {
      const u = smtpUrl(input.url);
      if (!u) return bad('bad_smtp', 'The mail server looks like smtps://smtp.gmail.com:465 or smtp://mail.example.com:587');
      const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      // The metadata rule every other kind follows (guard.ts), on the host as typed.
      const why = refusal(new URL(`https://${u.hostname}:${smtpPort(u)}`));
      if (why === 'blocked') return bad('blocked_address', 'That address belongs to a cloud metadata service and is refused');
      const username = (input.username ?? '').trim();
      if (username.length > 254 || /[\r\n]/.test(username)) return bad('bad_username', 'That user name is not valid');
      const t = token(input.token, false); if (isInvalid(t)) return t;
      const to = [...new Set((input.to ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
      if (!to.length || to.length > MAX_RECIPIENTS || !to.every((x) => MAILBOX.test(x))) {
        return bad('bad_recipient', `Send to one to ${MAX_RECIPIENTS} email addresses, separated by commas`);
      }
      const from = (input.from ?? '').trim() || (MAILBOX.test(username) ? username : '');
      if (!MAILBOX.test(from)) return bad('bad_sender', 'The sender must be an email address (usually the account you sign in with)');
      const url = `${u.protocol}//${u.hostname}:${smtpPort(u)}`;
      return {
        ok: true,
        secret: { url, ...(username ? { username } : {}), ...(t ? { token: t } : {}), from, to },
        config: { display: `${u.protocol}//${host}:${smtpPort(u)} → ${to.join(', ')}`, hasToken: !!t },
      };
    }
  }
}

/**
 * RFC 2047 for a header that is not plain ASCII. ntfy decodes it; fetch would otherwise throw on the first
 * character above U+00FF, and a server named in Japanese is not an edge case here.
 */
const headerText = (s: string): string => {
  const one = s.replace(/[\r\n]+/g, ' ').slice(0, 250);
  return /^[\x20-\x7e]*$/.test(one) ? one : `=?UTF-8?B?${Buffer.from(one, 'utf8').toString('base64')}?=`;
};

/**
 * A scraped title as plain text inside Discord's markdown: every character Discord gives a meaning to --
 * links `[x](y)` and `<url>`, emphasis, strike, spoilers, code, quotes, headings -- gets a backslash, which
 * Discord drops when it renders. Mentions are handled separately, by `allowed_mentions` below.
 */
export const discordText = (s: string): string => s.replace(/[\\`*_~|>#[\]()<]/g, '\\$&');

const json = (extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', 'user-agent': 'Uchiyomi', ...extra });

/**
 * One POST for one target. Null when what is stored no longer makes sense for its kind (a hand-edited row),
 * which the caller treats like a secret it cannot read: no request.
 */
export function buildRequest(kind: Kind, secret: TargetSecret, config: TargetConfig, msg: Message): OutboundRequest | null {
  if (kind === 'email') return null; // not an HTTP POST: emailMessage + lib/notify/email.ts
  const u = safeUrl(secret.url);
  if (!u) return null;
  const bearer: Record<string, string> = secret.token && TOKEN.test(secret.token) ? { authorization: `Bearer ${secret.token}` } : {};
  switch (kind) {
    case 'webhook':
      return { url: u.href, headers: json(bearer), body: JSON.stringify({ event: msg.event, title: msg.title, message: msg.message, count: msg.count, series: msg.series }) };
    case 'home_assistant': {
      // ⚠️ REBUILT, never concatenated: the stored origin plus a service name that matched HA_SERVICE. A
      // service of `../../auth/providers` concatenated into a path would be normalised by URL into another
      // endpoint on the same trusted origin, with the long-lived token attached (the engineCoverUrl lesson).
      const service = config.service ?? '';
      if (!HA_SERVICE.test(service) || !secret.token) return null;
      const [domain, name] = service.split('.');
      return { url: `${u.origin}/api/services/${domain}/${name}`, headers: json(bearer), body: JSON.stringify({ title: msg.title, message: msg.message }) };
    }
    case 'ntfy': {
      if (!secret.topic || !NTFY_TOPIC.test(secret.topic)) return null;
      const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
      return {
        url: `${base}/${secret.topic}`,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'user-agent': 'Uchiyomi', title: headerText(msg.title), ...bearer },
        body: msg.message,
      };
    }
    case 'discord': {
      const content = `**${msg.title}**\n${msg.message}`;
      // `allowed_mentions: parse []`: a scraped series title containing "@everyone" must not ping a server.
      return { url: `${u.origin}${u.pathname}`, headers: json(), body: JSON.stringify({ content: content.length > 2000 ? `${content.slice(0, 1999)}…` : content, allowed_mentions: { parse: [] } }) };
    }
  }
}

export interface EmailMessage { subject: string; text: string }

/**
 * One notification as an email: the subject is the server's name and the message's first line, the body the message.
 * Plain text only -- a scraped title in HTML is a link someone else wrote. Line breaks in the subject are spaces, so a
 * title cannot add a header.
 */
export function emailMessage(msg: Message): EmailMessage {
  const first = msg.message.split('\n')[0] ?? '';
  const subject = `${msg.title}: ${first}`.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').slice(0, 200);
  const lines = [msg.message];
  if (msg.series.length > 1 && msg.event === 'new_chapters') {
    lines.push('', ...msg.series.slice(0, 50).map((s) => `• ${s.title}${s.added ? ` (+${s.added})` : ''}`));
  }
  lines.push('', `— ${msg.title}`);
  return { subject, text: lines.join('\n') };
}
