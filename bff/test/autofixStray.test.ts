// An amber Health card Fix everything's summary has no line for is still Needs you, never "All green" over it.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
process.env.CONFIG_DIR ||= '/tmp/uchiyomi-test-config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { strayChecks, SUMMARISED } = require('../src/lib/autofix') as typeof import('../src/lib/autofix');

const card = (id: string, status: 'ok' | 'warn' | 'problem') => ({ id, title: id, status, summary: '', items: [] }) as any;

test('an amber card nobody names is stray, a green one and a named one are not', () => {
  const out = strayChecks([card('newcheck', 'warn'), card('other', 'problem'), card('quiet', 'ok'), card('files', 'warn'), card('sources', 'problem')]);
  assert.deepEqual(out.map((c) => c.id), ['newcheck', 'other']);
});

test('every check Health runs that can turn amber is either named by the summary or says so here', () => {
  // The informational cards (version, stalled, orphans) never turn amber, so they need no line.
  for (const id of ['solver', 'files', 'covers', 'details', 'disk', 'trackers', 'chapter-gaps', 'chapter-failures', 'short-chapters']) {
    assert.equal(SUMMARISED.has(id), true, id);
  }
});
