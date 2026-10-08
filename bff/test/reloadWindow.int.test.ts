// A reload must not empty the registry while it waits for the engine.
//
// reloadAll() used to clear the registry first and ask the engine for its sources after. An engine busy installing an
// extension answers slowly, so for seconds every extension source was unregistered and Health's "series that can no
// longer update" listed every extension series as "its source is no longer installed" -- while Fix everything, which
// reloads after each install and uninstall, was running. The registry is now swapped in one synchronous step after
// the engine has answered.
//
// Skipped automatically unless TEST_DATABASE_URL is set (CI provides a throwaway Postgres service).
import test from 'node:test';
import assert from 'node:assert/strict';

const DSN = process.env.TEST_DATABASE_URL;

test('the sources stay registered while a reload waits for the engine', { skip: DSN ? false : 'set TEST_DATABASE_URL to run' }, async () => {
  const { startFakeSuwayomi, SOURCE_IDS } = await import('./fixtures/fakeSuwayomi');
  const fake = await startFakeSuwayomi();
  process.env.DATABASE_URL = DSN;
  process.env.SUWAYOMI_URL = fake.url;
  process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR ||= '/tmp/uchiyomi-test-config';
  const { migrate } = await import('../src/lib/migrate');
  const { q, pool } = await import('../src/lib/db');
  const reg = await import('../src/lib/sources/suwayomi/register');
  const { listRemoteSources } = await import('../src/lib/sources/suwayomi/sources');
  const { getSource, reloadSources } = await import('../src/lib/sources/loader');
  await migrate();
  await q('DELETE FROM suwayomi_sources');
  await q(`INSERT INTO suwayomi_sources (source_id, name, lang, enabled) VALUES ($1,'Manga Ball','en',true)`, [SOURCE_IDS.mangaBall]);
  const id = `sw:${SOURCE_IDS.mangaBall}`;
  const quiet = [console.warn, console.log] as const;
  console.warn = () => {};
  console.log = () => {};
  try {
    await reg.loadSuwayomiSources();
    assert.ok(getSource(id), 'registered to begin with');

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let swapped = false;
    /**
     * Reintroduce by clearing the registry before the engine is asked (reload.ts running reloadSources() ahead of
     * loadSuwayomiSources): the source is gone while the engine is still answering, and this fails.
     */
    const slow = reg.loadSuwayomiSources(async () => { await gate; return listRemoteSources(); }, {
      beforeRegister: () => { swapped = true; reloadSources(); },
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(swapped, false, 'the swap waits for the engine');
    assert.ok(getSource(id), 'the extension source is still registered while the engine is slow');
    release();
    const r = await slow;
    assert.equal(swapped, true);
    assert.equal(r.reachable, true);
    assert.ok(getSource(id), 'and registered again right after the swap');
  } finally {
    console.warn = quiet[0];
    console.log = quiet[1];
    reg.stopSuwayomiRetry();
    await q('DELETE FROM suwayomi_sources').catch(() => {});
    await fake.close();
    await pool.end().catch(() => {});
  }
});
