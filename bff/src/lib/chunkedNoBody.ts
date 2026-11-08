import type { FastifyInstance } from 'fastify';

/**
 * A POST with no body and no Content-Type, which `fetch('/auth/refresh', { method: 'POST' })` is, reaches the app
 * from some proxies as `Transfer-Encoding: chunked` with neither header (cloudflared 2026.10.7 through a Cloudflare
 * Tunnel does this; a plain proxy sends `Content-Length: 0`). Fastify takes that for a body of an unknown type and
 * answers 415 before the route runs. The web app reads any refresh answer other than 401/403 as "server
 * unreachable", so every page load fell back to Offline downloads (web/lib/api.ts refreshSession).
 *
 * The chunked marker is dropped only when there is no Content-Type: with one, the body is parsed (or refused) as
 * before, and a body-less request that names no type has nothing for a parser to read. Reintroduce the 415 by
 * removing this hook: chunkedNoBody.test.ts sees the refresh answered 415 instead of reaching the route.
 */
export function acceptChunkedNoBody(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    const h = req.headers;
    if (h['content-type'] === undefined && h['content-length'] === undefined && h['transfer-encoding'] !== undefined) {
      delete h['transfer-encoding'];
    }
  });
}
