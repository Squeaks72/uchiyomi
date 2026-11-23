// The reader-email confirmation code (routes/readerEmail.ts): six digits is only a million, so the code must expire and die after
// a few wrong guesses -- otherwise anyone can PUT a stranger's address and guess their way to "confirmed".
// Skipped automatically unless TEST_DATABASE_URL is set.
import test from 'node:test';
import assert from 'node:assert/strict';

const DSN = process.env.TEST_DATABASE_URL;
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || '/tmp/uchiyomi-test-config';
  process.env.LIBRARY_BACKEND = 'owned';
}
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';

test('reader email confirmation code', { skip }, async (t) => {
  const { migrate } = await import('../src/lib/migrate');
  const { q, one, pool } = await import('../src/lib/db');
  const routes = (await import('../src/routes/readerEmail')).default;
  const Fastify = (await import('fastify')).default;
  const jwt = (await import('@fastify/jwt')).default;
  await migrate();
  await q(`DELETE FROM users WHERE username = 're-reader'`);
  const uid = (await q<{ id: string }>(
    `INSERT INTO users (username, display_name, password_hash, role, auth_kind) VALUES ('re-reader','re-reader','x','user','password') RETURNING id`))[0].id;
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  await app.register(routes);
  await app.ready();
  const auth = { authorization: `Bearer ${app.jwt.sign({ sub: uid, role: 'user' })}` };
  const issue = (code: string, ageMin = 0) => q(
    `UPDATE users SET notify_email = 'a@b.co', notify_email_verified_at = NULL, notify_email_code = $2,
            notify_email_code_issued_at = now() - ($3 || ' minutes')::interval, notify_email_code_tries = 0 WHERE id = $1`, [uid, code, String(ageMin)]);
  const verify = (code: string) => app.inject({ method: 'POST', url: '/api/me/email/verify', headers: auth, payload: { code } });
  const verified = async () => !!(await one<{ v: Date | null }>('SELECT notify_email_verified_at AS v FROM users WHERE id = $1', [uid]))?.v;

  try {
    await t.test('the right code confirms', async () => {
      await issue('123456');
      assert.equal((await verify('123456')).statusCode, 200);
      assert.ok(await verified());
    });
    await t.test('a code dies after five wrong guesses, even if the sixth is right', async () => {
      await issue('123456');
      for (let i = 0; i < 5; i++) assert.equal((await verify('000000')).statusCode, 400);
      const last = await verify('123456');
      assert.equal(last.statusCode, 400, 'the right code no longer works once the guesses ran out');
      assert.equal(last.json().error, 'code_expired');
      assert.ok(!(await verified()));
      assert.equal((await verify('123456')).statusCode, 400, 'and the code is gone');
    });
    await t.test('a code older than fifteen minutes is refused', async () => {
      await issue('654321', 16);
      const r = await verify('654321');
      assert.equal(r.statusCode, 400);
      assert.ok(!(await verified()));
    });
    await t.test('a code issued a few minutes ago still works', async () => {
      await issue('654321', 10);
      assert.equal((await verify('654321')).statusCode, 200);
    });
  } finally {
    await app.close();
    await q(`DELETE FROM users WHERE username = 're-reader'`).catch(() => {});
    await pool.end().catch(() => {});
  }
});
