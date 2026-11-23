// The reader settings in this browser belong to one account. On a shared device the next profile used to inherit the previous one's
// global settings and per-series / per-source looks, and push them into its own settings row (lib/readerPrefs.ts claimReaderPrefs).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_API_BASE = '';
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  get length() { return mem.size; },
  key: (i: number) => [...mem.keys()][i] ?? null,
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};
(globalThis as any).window = globalThis;

test('another account signing in does not inherit the reader settings; the same one keeps them', async () => {
  const { claimReaderPrefs } = await import('../lib/readerPrefs');
  const seed = () => {
    mem.set('yomi_reader_prefs', '{"theme":"paper"}');
    mem.set('yomi_rs_s1', '{"zoom":1.5}');
    mem.set('yomi_rp_src', '{"mode":"paged"}');
    mem.set('yomi_srcof_s1', '"mangadex"'); // a cache of the server's answer, not an account's setting: kept
  };
  mem.clear();
  seed();
  claimReaderPrefs('alice');
  assert.equal(mem.get('yomi_reader_prefs'), '{"theme":"paper"}', 'the first claim after an update only records the owner');
  claimReaderPrefs('alice');
  assert.equal(mem.get('yomi_rs_s1'), '{"zoom":1.5}', 'the same account signing in again keeps its settings');
  claimReaderPrefs('bob');
  assert.equal(mem.get('yomi_reader_prefs'), undefined, "bob does not get alice's global settings");
  assert.equal(mem.get('yomi_rs_s1'), undefined, "nor her per-series looks");
  assert.equal(mem.get('yomi_rp_src'), undefined, "nor her per-source ones");
  assert.equal(mem.get('yomi_srcof_s1'), '"mangadex"', 'a cache of what the server said is not an account setting');
  assert.equal(mem.get('yomi_prefs_owner'), 'bob');
});
