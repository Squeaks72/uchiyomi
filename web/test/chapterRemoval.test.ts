// Remove a chapter from the library, the slow archive's explanation, the sticky rail's own scroll and the download
// button's progress. Read from source, like seriesPage.test.ts: none of these has a unit to call, and each is the kind
// of thing a later tidy-up drops without any behavioural test noticing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const page = read('app/series/page.tsx');

test('a chapter row offers Remove from series, behind a confirmation', () => {
  assert.match(page, /tr\('Remove from series'\)/);
  assert.match(page, /\/chapters\/remove/);
  assert.match(page, /tr\('Remove this chapter from the series\?'\)/);
});

test('Properties lists the removed chapters with a Restore for each and for all', () => {
  const sheet = read('components/SeriesPropertiesSheet.tsx');
  assert.match(sheet, /\/chapters\/removed/);
  assert.match(sheet, /\/chapters\/restore/);
  assert.match(sheet, /tr\('Restore all'\)/);
});

test('the Archive slowly button says what it is for, on the series page and in the library', () => {
  assert.match(page, /data-archive-why/);
  assert.match(page, /archiveWhy\(\)/);
  const lib = read('app/library/page.tsx');
  assert.ok((lib.match(/archiveWhy\(\)/g) || []).length >= 2, 'the library bulk bar and More sheet both explain it');
  assert.match(read('lib/archive.ts'), /never hit with a burst/);
});

test('the chapter rail scrolls on its own when the window is short', () => {
  assert.match(page, /data-series-rail/);
  assert.match(page, /lg:max-h-\[calc\(100dvh-6rem\)\]/);
  assert.match(page, /lg:overflow-y-auto/);
  // lenisScrollers: the rail only claims the wheel while it actually overflows.
  assert.match(page, /data-lenis-prevent=\{railScrolls \? '' : undefined\}/);
});

test('fetching a missing chapter shows progress, then that it landed', () => {
  assert.match(page, /data-fetching/);
  assert.match(page, /aria-busy/);
  assert.match(page, /data-fetched/);
  assert.match(page, /tr\('Fetched'\)/);
  assert.match(page, /motion-safe:animate-spin/);
});

test('the series page puts the extras one tap away for the admin, over the series override', () => {
  assert.match(page, /data-show-extras/);
  assert.match(page, /json: \{ hideNotices: !show \}/);
  assert.match(page, /aria-pressed=\{!series\.hideNoticesEffective\}/);
});

test('Discover cards have the right-click menu a library card has', () => {
  const menu = read('components/DiscoverMenu.tsx');
  assert.match(menu, /useContextMenu\(items, \{ label: title \}\)/);
  for (const k of ['Open in library', 'Add to library', 'Search all sources for this title', 'Copy title']) assert.ok(menu.includes(`tr('${k}')`), k);
  assert.match(read('components/cards.tsx'), /useDiscoverMenu\(\{ title: item\.title/);
  assert.match(read('components/cards.tsx'), /\{\.\.\.menu\.bind\}>\{body\}<\/button>/, 'an addable card has no menu');
  assert.match(read('components/DiscoverHero.tsx'), /useDiscoverMenu\(\{ title: t\.title/);
  assert.match(read('app/discover/page.tsx'), /onSearch=\{searchFor\}/);
});

test('a search result the library already holds opens that entry, even when another provider is in a language it lacks', () => {
  const p = read('app/discover/page.tsx');
  assert.match(p, /inLibrary: !!g\.inLibrary \|\| g\.providers\.some\(\(p\) => p\.inLibrary\)/);
  assert.match(p, /moreEditions: true/);
  assert.match(read('components/cards.tsx'), /libraryHref = owned && item\.librarySeriesId/);
});

test('a favourite wears a star in the corner of its thumbnail, in both tile sizes', () => {
  const cards = read('components/cards.tsx');
  assert.equal((cards.match(/<IcStar [^>]*data-favorite-star/g) || []).length, 2);
  assert.doesNotMatch(cards, /IcHeart/);
});
