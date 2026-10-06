import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cappedMembers, filterByName, limitParts, ratedLibraries, ratingOrder, ratingSummary } from '../lib/contentRatings';
import { isBlocked } from '../lib/sourcesPanel';
import { visibleGroups } from '../lib/desktop';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('the counts quote members with a cap and libraries with a rating, and 0 counts as a choice', () => {
  assert.equal(cappedMembers([{ max_age_rating: null }, { max_age_rating: 13 }, { max_age_rating: 0 }, {}]), 2);
  assert.equal(cappedMembers(undefined), 0);
  assert.equal(ratedLibraries([{ age_rating: 18 }, { age_rating: null }, {}]), 1);
  assert.equal(ratedLibraries(undefined), 0);
});

test('the summary counts what an admin rated and what is held to 18+ either way', () => {
  const s = ratingSummary([
    { ageRating: 18, defaultAgeRating: null },   // rated adult by the admin
    { ageRating: null, defaultAgeRating: 18 },   // adult by its extension, not rated
    { ageRating: 0, defaultAgeRating: 18 },      // admin said all ages: rated, and not adult
    { ageRating: 13, defaultAgeRating: null },   // rated, below 18
    { ageRating: null, defaultAgeRating: null }, // nothing
  ]);
  assert.deepEqual(s, { rated: 3, adult: 2 });
  assert.deepEqual(ratingSummary(undefined), { rated: 0, adult: 0 });
});

test('the list puts the admin-rated sources first, then the extension-flagged, then the rest by name', () => {
  const rows = [
    { id: 'c', name: 'Charlie', ageRating: null, defaultAgeRating: null },
    { id: 'b', name: 'Bravo', ageRating: null, defaultAgeRating: 18 },
    { id: 'z', name: 'Zulu', ageRating: 13, defaultAgeRating: null },
    { id: 'a', name: 'Alpha', ageRating: null, defaultAgeRating: null },
    { id: 'y', name: 'Yankee', ageRating: 0, defaultAgeRating: 18 },
  ];
  assert.deepEqual(ratingOrder(rows).map((r) => r.id), ['y', 'z', 'b', 'a', 'c']);
  assert.deepEqual(rows.map((r) => r.id), ['c', 'b', 'z', 'a', 'y'], 'the input is sorted in place');
});

test('the filter matches a name or an id, in any case, and an empty box is everything', () => {
  const rows = [{ id: 'mangadex-en', name: 'MangaDex' }, { id: 'xyz', name: 'Other Site' }];
  assert.deepEqual(filterByName(rows, ' DEX ').map((r) => r.id), ['mangadex-en']);
  assert.deepEqual(filterByName(rows, 'xyz').map((r) => r.id), ['xyz']);
  assert.equal(filterByName(rows, '  ').length, 2);
});

test('limits are said in seconds and gigabytes, never milliseconds or bytes', () => {
  assert.deepEqual(limitParts({ value: 8000, unit: 'ms' }), { kind: 's', n: '8' });
  assert.deepEqual(limitParts({ value: 1500, unit: 'ms' }), { kind: 's', n: '1.5' });
  assert.deepEqual(limitParts({ value: 5 * 2 ** 30, unit: 'bytes' }), { kind: 'gb', n: '5' });
  assert.deepEqual(limitParts({ value: 4, unit: 'count' }), { kind: 'plain', n: '4' });
  assert.deepEqual(limitParts({ value: 14, unit: 'files' }), { kind: 'plain', n: '14' });
});

test('a source is blocked when it is cooling or its state says so', () => {
  assert.equal(isBlocked({ standing: 'cooling', state: 'ok' } as never), true);
  assert.equal(isBlocked({ standing: 'ok', state: 'blocked' } as never), true);
  assert.equal(isBlocked({ standing: 'ok', state: 'ok' } as never), false);
});

test('visibleGroups keeps a group\'s links while it drops hidden tabs', () => {
  const groups = [
    { id: 'a', label: 'A', tabs: ['One', 'Two'] as const, links: [{ label: 'Import', href: '/admin/import/' }] },
    { id: 'b', label: 'B', tabs: ['Three'] as const },
  ];
  const out = visibleGroups(groups, ['Three', 'Two']);
  assert.deepEqual(out, [{ id: 'a', label: 'A', tabs: ['One'], links: [{ label: 'Import', href: '/admin/import/' }] }]);
});

test('Admin has an Import entry in the Content group, and Settings links to Backups', () => {
  const page = code(read('app/admin/page.tsx'));
  assert.match(page, /id: 'content', label: 'Content', tabs: keys\('Library', 'Health', 'Art'\), links: \[\{ label: keys\('Import'\)\[0\], href: '\/admin\/import\/' \}\]/);
  const settings = code(read('components/AdminSettings.tsx'));
  assert.match(settings, /<Link href="\/admin\/\?tab=Tasks&section=task-backup"/, 'the backup hour has no Backups link');
});

test('Downloads & politeness shows the limits read-only and unblocks through the source route', () => {
  const src = code(read('components/ArchiveSettings.tsx'));
  const section = src.slice(src.indexOf('export function PolitenessSection('));
  assert.match(section, /api<\{ limits: Limit\[\]; note: string \}>\('\/api\/admin\/limits'\)/);
  assert.match(section, /\/unblock`, \{ method: 'POST' \}/);
  assert.match(section, /tr\('No sources are blocked right now\.'\)/);
  assert.doesNotMatch(section, /<input|<NumberRow|<SwitchRow/, 'a read-only list grew a control for a variable the server reads at boot');
});
