// Readers who may not reach the sources (2026-11-18): their own Discover, nothing on it asks a source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

test('a reader who may not add series gets the member Discover, an admin the requests inbox', () => {
  const page = read('app/discover/page.tsx');
  assert.match(page, /if \(!mayAdd\) return <MemberDiscover \/>;/);
  assert.match(page, /\{isAdmin && <RequestsInbox \/>\}/);
});

test('the member Discover asks only the server: the library, the stored AniList picks, and requests', () => {
  const md = read('components/MemberDiscover.tsx');
  const calls = [...md.matchAll(/api<[^>]*>\(\s*[`'"]([^`'"?$]+)/g)].map((m) => m[1]);
  for (const c of calls) assert.ok(/^\/api\/(series\/search|requests|discover\/(because|trending))/.test(c), `member Discover calls ${c}`);
  assert.doesNotMatch(md, /\/api\/sources/, 'a source route');
});
