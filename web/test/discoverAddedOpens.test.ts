// A title added from Discover while the page stays open opens its entry when tapped, like one the library already held.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the add answer\'s series id reaches the card, and a card with none looks the title up when tapped', () => {
  const page = read('app/discover/page.tsx');
  // Keyed by the card's work (v0.56.0), not by its title: the saved title is the source's own and can differ.
  assert.match(page, /const info = \{ seriesId: r\.seriesId, folder: r\.folder, title: r\.title \};/, 'the id the server named is kept');
  assert.match(page, /for \(const k of keys\.filter\(Boolean\)\) next\.set\(k, info\);/, 'what the add learned is not kept under the card\'s work');
  assert.match(page, /librarySeriesId: a\.seriesId \?\? it\.librarySeriesId/, 'the card becomes a link to it');
  assert.match(page, /onOpenAdded=\{shownAddedInfo\.has\(workKey\(it\)\)/);
  assert.match(read('lib/waitForSeries.ts'), /normTitle\(s\.metadata\?\.title \|\| s\.name\) === normTitle\(title\)/, 'exact title only, never the first hit');
  assert.match(page, /downloadsHref\(a\.folder\)/, 'a download whose row is not there yet falls back to the Downloads view');
  const card = read('components/cards.tsx');
  assert.match(card, /onClick=\{onOpenAdded \?\? onAdd\} disabled=\{owned && !onOpenAdded\}/);
});
