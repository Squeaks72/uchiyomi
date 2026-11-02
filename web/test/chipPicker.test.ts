// The long chip lists: the chosen ones always shown, the rest found by search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickable } from '../components/ChipPicker';

const opts = [{ key: 'action', label: 'Action' }, { key: 'sci-fi', label: 'Sci-Fi' }, { key: 'romance', label: 'Romance' }, { key: 'cafe', label: 'Café' }];

test('pickable: unselected matches only, case- and accent-blind, in the list\'s order', () => {
  assert.deepEqual(pickable(opts, new Set(['action']), '').map((o) => o.key), ['sci-fi', 'romance', 'cafe'], 'a chosen chip is never offered again');
  assert.deepEqual(pickable(opts, new Set(), 'ROM').map((o) => o.key), ['romance']);
  assert.deepEqual(pickable(opts, new Set(), 'cafe').map((o) => o.key), ['cafe'], 'accents do not stand in the way');
  assert.deepEqual(pickable(opts, new Set(), 'sci').map((o) => o.key), ['sci-fi']);
  assert.deepEqual(pickable(opts, new Set(), 'zzz'), []);
});

test('the long lists use it: adult genres, Mixed sources, the chapter filter\'s groups', () => {
  const r = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  assert.match(r('components/AdminSettings.tsx'), /<ChipPicker label=\{tr\('Genres'\)\}/, 'the 18+ genre list is a wall of chips again');
  assert.match(r('components/AdminSettings.tsx'), /<ChipPicker label=\{tr\('Sources'\)\}/, 'the Mixed picker is a wall of chips again');
  assert.match(r('components/ChapterFilterSheet.tsx'), /<ChipPicker single label=\{tr\('Translated by'\)\}/, 'the group filter is a wall of chips again');
  const c = r('components/ChipPicker.tsx');
  assert.match(c, /data-chip-picker-selected/, 'the chosen chips are not always drawn');
  assert.match(c, /data-no-autofocus/, 'a picker in a sheet raises its list on open');
});

test('it draws the chosen chips and a search box, and none of the other options until asked', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ChipPicker } = await import('../components/ChipPicker');
  const html = renderToStaticMarkup(createElement(ChipPicker, { label: 'Genres', options: opts, selected: ['romance'], onToggle: () => {} }));
  assert.match(html, /Romance/, 'a chosen chip is shown');
  assert.doesNotMatch(html, /Sci-Fi|Action|Café/, 'unchosen options stay behind the search');
  assert.match(html, /type="search"/, 'there is a search box');
  assert.match(html, /placeholder="Search 4…"/, 'it says how many there are to search');
  const none = renderToStaticMarkup(createElement(ChipPicker, { label: 'Genres', options: [], selected: ['gone'], onToggle: () => {} }));
  assert.match(none, /gone/, 'a stored choice the list no longer has is still shown, so it can be taken off');
  assert.doesNotMatch(none, /type="search"/, 'no search box over an empty list');
});

test('Discover\'s Sources sheet lets an admin include a source Show 18+ keeps out (Mixed), through the same picker as Settings', () => {
  const r = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  assert.match(r('components/SourceListSheet.tsx'), /\{isAdmin && \(\s*<section[^>]*data-include-sources>[\s\S]*<MixedSourcesPicker \/>/, 'the sheet has no way to include a hidden source');
  assert.match(r('components/AdminSettings.tsx'), /import \{ MixedSourcesPicker \} from '@\/components\/MixedSourcesPicker';/, 'Settings lost the picker');
  const p = r('components/MixedSourcesPicker.tsx');
  assert.match(p, /\/age-rating`, \{ method: 'PUT', json: ageRequest\(mixed \? 'mixed' : 'default'\) \}/, 'the picker does not rate the source on the server');
  assert.match(p, /\(s\.ageRating \?\? 0\) >= 18 \|\| s\.mixed/, 'a source rated Adult only cannot be included');
});
