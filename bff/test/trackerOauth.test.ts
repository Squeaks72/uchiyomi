// The server half of signing in to a tracker without pasting a token: Kitsu's password exchange, which needs no
// database, and the shape of what a service answers. The parts that read the saved application are in
// trackerOauth.int.test.ts (they need Postgres).
import test from 'node:test';
import assert from 'node:assert/strict';

// Loading the module loads the database client, whose settings are checked at import; nothing here queries.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@localhost:1/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
const oauth = () => import('../src/lib/trackerOauth');

const realFetch = globalThis.fetch;
const stub = (status: number, body: unknown, seen?: { url?: string; init?: RequestInit }) => {
  globalThis.fetch = (async (url: any, init: any) => {
    if (seen) { seen.url = String(url); seen.init = init; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
};
test.afterEach(() => { globalThis.fetch = realFetch; });

test('each tracker has one way of connecting', async () => {
  const { METHOD } = await oauth();
  assert.deepEqual(METHOD, { anilist: 'oauth-implicit', myanimelist: 'oauth-code', kitsu: 'password', mangaupdates: 'password' });
});

test('Kitsu: the password goes to the token endpoint once and a token comes back', async () => {
  const { kitsuPasswordLogin } = await oauth();
  const seen: { url?: string; init?: RequestInit } = {};
  stub(200, { access_token: 'tok_abcdefghij', expires_in: 2592000, token_type: 'Bearer' }, seen);
  const g = await kitsuPasswordLogin('me@example.com', 'hunter2');
  assert.equal(g.token, 'tok_abcdefghij');
  assert.equal(g.expiresInSec, 2592000);
  assert.match(seen.url!, /kitsu\.io\/api\/oauth\/token$/);
  assert.deepEqual(JSON.parse(String(seen.init!.body)), { grant_type: 'password', username: 'me@example.com', password: 'hunter2' });
});

test('Kitsu: a refusal is a verdict on the sign-in, not an outage', async () => {
  const { kitsuPasswordLogin } = await oauth();
  stub(400, { error: 'invalid_grant', error_description: 'The provided authorization grant is invalid' });
  await assert.rejects(() => kitsuPasswordLogin('me', 'wrong'), (e: any) => e.rejected === true && /invalid/.test(e.message));
});

test('Kitsu: an answer with no token is an error even on a 200', async () => {
  const { kitsuPasswordLogin } = await oauth();
  stub(200, { hello: 'world' });
  await assert.rejects(() => kitsuPasswordLogin('me', 'x'), /did not give a token/);
});
