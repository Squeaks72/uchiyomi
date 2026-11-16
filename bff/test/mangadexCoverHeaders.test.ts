// MangaDex's CDN (uploads.mangadex.org) sends a browser-like User-Agent to a bot challenge (302 to /edge/challenge) and
// refuses the Sec-Fetch headers outright, so the cover proxy's generic Chrome headers failed every cover. The adapter's own
// image headers (which the proxy applies over its defaults) carry the identifying, non-browser User-Agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('the MangaDex adapter fetches images with its non-browser User-Agent', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'sources', 'mangadex.ts'), 'utf8');
  assert.match(src, /const HEADERS = \{ 'user-agent': 'Uchiyomi\/[^']*' \};/, 'the identifying User-Agent');
  assert.match(src, /imageHeaders: HEADERS,/, 'sent with every image fetch');
  assert.doesNotMatch(/const HEADERS = [^\n]*(Mozilla|Chrome)/.exec(src)?.[0] ?? '', /./, 'never a browser one');
});
