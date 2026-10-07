process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { adultSourceName, explicitGenre, explicitTitle } from '../src/lib/adultSignals';

let ratingOf: typeof import('../src/lib/searchAll').ratingOf;
before(async () => { ({ ratingOf } = await import('../src/lib/searchAll')); });

const lists = { genres: ['hentai', 'adult', 'smut', 'ecchi'], sources: [] as string[], cleared: [] as string[] };

test('a source whose name says it is adult is recognised, and a mainstream one is not', () => {
  for (const n of ['MyAdultComics', 'Doujin.io - J18', 'KingComiX', 'Manhwa18.cc', '18 Porn Comic', 'LustToon', 'SchaleNetwork']) assert.equal(adultSourceName(n), true, n);
  for (const n of ['MangaDex', 'MangaFire', 'Toonily', 'Tapas', 'Coolmic', 'Comic 180', 'Webtoons.com', undefined]) assert.equal(adultSourceName(n), false, String(n));
});

test('explicit genres count whatever the admin typed', () => {
  assert.equal(explicitGenre(' Creampie '), true);
  assert.equal(explicitGenre('Aggressive Sex'), true);
  assert.equal(explicitGenre('Romance'), false);
});

test('an explicit title is caught by whole word only', () => {
  assert.equal(explicitTitle('No One Wants to Fuck More Than We Do'), true);
  assert.equal(explicitTitle("Yamori's Cum Toilets"), true);
  assert.equal(explicitTitle('Cumberland Chronicles'), false);
  assert.equal(explicitTitle('Textual Analysis'), false);
  assert.equal(explicitTitle('How Do We Relationship?'), false);
});

test('a search result from an adult-named source, or with explicit genres or title, is 18+ even while the flag is not trusted', () => {
  const flagged = { id: 'sw:1', name: 'MyAdultComics', isNsfw: true };
  assert.equal(ratingOf({ title: 'Cheeky LUCID' }, flagged, lists, false), 'adult', 'by the source name');
  assert.equal(ratingOf({ title: 'x', genres: ['Blowjob', 'Big Breasts'] }, { id: 'sw:2', name: 'Some Site', isNsfw: true }, lists, false), 'adult', 'by genre');
  assert.equal(ratingOf({ title: 'Mom’s Fucking Help' }, { id: 'sw:3', name: 'Some Site', isNsfw: true }, lists, false), 'adult', 'by title');
  assert.equal(ratingOf({ title: 'How Do We Relationship?' }, { id: 'sw:4', name: 'MangaFire', isNsfw: true }, lists, false), undefined, 'mainstream stays shown');
});

test('a source the admin rated below 18 is not judged by its name', () => {
  assert.equal(ratingOf({ title: 'Plain' }, { id: 'sw:1', name: 'MyAdultComics', isNsfw: true }, { ...lists, cleared: ['sw:1'] }, false), undefined);
});

test('a title an admin marked 18+ from a Discover card is 18+ however it is spelled, and only that title', async () => {
  const { titleKey } = await import('../src/lib/adultTitles');
  assert.equal(titleKey('  Éclair: The  Series! '), titleKey('eclair the series'));
  assert.equal(titleKey('進撃の巨人'), '進撃の巨人');
  assert.equal(titleKey('!!!'), '');
  const withTitles = { ...lists, titles: new Set([titleKey('Marked Title')]) };
  const src = { id: 'sw:9', name: 'Some Site', isNsfw: false };
  assert.equal(ratingOf({ title: 'MARKED title!' }, src, withTitles, false), 'adult');
  assert.notEqual(ratingOf({ title: 'Another Title' }, src, withTitles, false), 'adult');
  assert.notEqual(ratingOf({ title: 'Marked Title' }, src, lists, false), 'adult', 'no marks, no effect');
});
