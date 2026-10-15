// The optional big banners and the description under a thumbnail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blurb } from '../lib/blurb';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

test('blurb strips markup and cuts at a word', () => {
  assert.equal(blurb(null), '');
  assert.equal(blurb('<p>Hello&nbsp;<b>world</b></p>'), 'Hello world');
  assert.equal(blurb('Summary: a short one'), 'a short one');
  const long = 'word '.repeat(80);
  const out = blurb(long, 40);
  assert.ok(out.endsWith('…') && out.length <= 41, out);
});

test('the big banners are behind the showBanners setting on Home and Discover', () => {
  assert.match(read('app/page.tsx'), /useAccountPrefValue\('showBanners'\)/);
  assert.match(read('app/discover/page.tsx'), /useAccountPrefValue\('showBanners'\)/);
  assert.match(read('components/ProfileSettings.tsx'), /useAccountPref\('showBanners'\)/);
});
