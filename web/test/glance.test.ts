import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { otherNames } from '../lib/glance';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

test('other names drop the main title and repeats, whatever the case', () => {
  assert.deepEqual(otherNames('Nana & Kaoru', ['nana & kaoru', ' Nana to Kaoru ', 'NANA TO KAORU', '', null, undefined]), ['Nana to Kaoru']);
});

test('every wall puts the description on the thumbnail and opens the same card', () => {
  // Put a description back under a thumbnail, or lose a wall's card, and the walls stop saying the same things.
  // A list's page is not its own wall any more: it draws the Library's tile (SeriesTile, v0.55.8 #164), so its
  // card is the tile's card, checked here on components/cards.tsx.
  for (const [file, builder] of [
    ['components/cards.tsx', 'glanceOfSeries'], ['components/cards.tsx', 'glanceOfSource'],
    ['components/DiscoverHero.tsx', 'glanceOfTrending'],
  ]) assert.ok(read(file).includes(`useGlance(${builder}(`) || read(file).includes(`useGlance(\n    ${builder}(`), `${file} has no ${builder} card`);
  for (const file of ['components/cards.tsx', 'components/DiscoverHero.tsx']) {
    assert.ok(!/<Blurb\b/.test(read(file)), `${file} still prints the description under the thumbnail`);
    assert.ok(read(file).includes('glance.overlay'), `${file} draws no hover text on the thumbnail`);
    assert.ok(read(file).includes('glance.modal'), `${file} never renders the card`);
  }
});

test('the card is opened from the thumbnail without opening the series, and from the menus for touch', () => {
  const card = read('components/GlanceCard.tsx');
  assert.match(card, /e\.preventDefault\(\); e\.stopPropagation\(\); setOpen\(true\)/);
  assert.match(card, /<OnBody>\s*<div onClick=\{stop\}/, 'events inside the card bubble to the thumbnail\'s link');
  assert.match(card, /Read more…/);
  assert.match(card, /useQuery\(\{[\s\S]*enabled: isAdmin && !!g\.altFrom/, 'other names are an admin read');
  assert.match(read('components/SeriesMenu.tsx'), /onDescribe \? \[\{ label: tr\('Description and details'\)/);
  assert.match(read('components/DiscoverMenu.tsx'), /onDescribe \? \[\{ label: tr\('Description and details'\)/);
});
