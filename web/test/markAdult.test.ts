// "Mark as 18+" on a card's menu, the optional big banners, and the description under a thumbnail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blurb } from '../lib/blurb';
import { hideTitle, titleKey, unhideTitle } from '../lib/hiddenTitles';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

test('blurb strips markup and cuts at a word', () => {
  assert.equal(blurb(null), '');
  assert.equal(blurb('<p>Hello&nbsp;<b>world</b></p>'), 'Hello world');
  assert.equal(blurb('Summary: a short one'), 'a short one');
  const long = 'word '.repeat(80);
  const out = blurb(long, 40);
  assert.ok(out.endsWith('…') && out.length <= 41, out);
});

test('the client title key folds the way the server does', () => {
  assert.equal(titleKey('Éclair: The  Series!'), titleKey('eclair the series'));
  assert.equal(titleKey('...'), '');
});

test('hiding a title twice or unhiding one that is not hidden changes nothing', () => {
  hideTitle('Zzz One'); hideTitle('zzz one'); unhideTitle('ZZZ ONE'); unhideTitle('zzz one');
});

test('library and Discover menus offer the mark, to admins, and Discover lists drop marked titles', () => {
  const mark = read('components/useAdultMark.ts');
  assert.match(mark, /if \(!isAdmin\) return \[\]/);
  assert.match(mark, /\/api\/admin\/adult-titles/);
  assert.match(mark, /\/api\/admin\/series\/\$\{encodeURIComponent\(seriesId\)\}\/adult/);
  assert.match(read('components/SeriesMenu.tsx'), /useAdultMark\(/);
  assert.match(read('components/DiscoverMenu.tsx'), /useAdultMark\(/);
  for (const f of ['app/discover/page.tsx', 'components/TrendingRail.tsx', 'components/RecommendationRail.tsx']) {
    assert.match(read(f), /useIsHiddenTitle\(\)/, f);
  }
});

test('the big banners are behind the showBanners setting on Home and Discover', () => {
  assert.match(read('app/page.tsx'), /useAccountPrefValue\('showBanners'\)/);
  assert.match(read('app/discover/page.tsx'), /useAccountPrefValue\('showBanners'\)/);
  assert.match(read('components/ProfileSettings.tsx'), /useAccountPref\('showBanners'\)/);
});
