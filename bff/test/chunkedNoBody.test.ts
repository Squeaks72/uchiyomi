import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { acceptChunkedNoBody } from '../src/lib/chunkedNoBody';

function post(port: number, headers: Record<string, string>, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ port, host: '127.0.0.1', method: 'POST', path: '/auth/refresh', headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, text }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function serve(withHook: boolean) {
  const app = Fastify();
  if (withHook) acceptChunkedNoBody(app);
  app.post('/auth/refresh', async (req) => ({ ok: true, body: req.body ?? null }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, port: (app.server.address() as AddressInfo).port };
}

test('a chunked POST with no body and no Content-Type reaches the route', async () => {
  const { app, port } = await serve(true);
  try {
    // Node sends Transfer-Encoding: chunked when a body is streamed with no Content-Length.
    const r = await post(port, { 'transfer-encoding': 'chunked' });
    assert.equal(r.status, 200, r.text);
  } finally { await app.close(); }
});

test('without the hook the same request is refused 415 (what cloudflared 2026.10.7 provoked)', async () => {
  const { app, port } = await serve(false);
  try {
    const r = await post(port, { 'transfer-encoding': 'chunked' });
    assert.equal(r.status, 415);
  } finally { await app.close(); }
});

test('a request that names a type is parsed as before, and an unknown type is still refused', async () => {
  const { app, port } = await serve(true);
  try {
    const ok = await post(port, { 'content-type': 'application/json' }, '{"a":1}');
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.text).body, { a: 1 });
    const bad = await post(port, { 'content-type': 'application/octet-stream' }, 'x');
    assert.equal(bad.status, 415);
  } finally { await app.close(); }
});
