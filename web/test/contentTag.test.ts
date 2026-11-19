// The cover tag says what the admin filed a series as (2026-11-19): Ecchi, Hentai, Pornhwa before its format.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentTag } from '../lib/contentTag';
import { seriesTypeKey } from '../lib/seriesTypes';

const ecchi = { name: 'ecchi', kind: 'genre', autoGenres: ['Ecchi'] };
const hentai = { name: 'hentai', kind: 'manga_adult' };
const pornhwa = { name: 'pornhwa', kind: 'webtoon_adult' };
const manga = { name: 'manga', kind: 'manga' };
const tag = (t: any, l: any) => contentTag(t, l, seriesTypeKey);

test('a genre library tags with its genre, whatever the format', () => {
  assert.deepEqual(tag('manga', ecchi), { label: 'Ecchi', kind: 'genre' });
  assert.deepEqual(tag(null, { ...ecchi, autoGenres: [] }), { label: 'ecchi', kind: 'genre' });
});

test('an 18+ library is Hentai or Pornhwa, by the series format first', () => {
  assert.equal(tag('manhwa', pornhwa)?.label, 'Pornhwa');
  assert.equal(tag('unknown', pornhwa)?.label, 'Pornhwa');
  assert.equal(tag('manga', pornhwa)?.label, 'Hentai');
  assert.equal(tag(null, hentai)?.label, 'Hentai');
  assert.equal(tag('manhwa', hentai)?.label, 'Pornhwa');
  assert.equal(tag('comic', hentai)?.label, 'Hentai');
});

test('everything else keeps its format, then the library name', () => {
  assert.deepEqual(tag('manhwa', manga), { label: 'Manhwa', kind: 'type' });
  assert.deepEqual(tag('unknown', manga), { label: 'manga', kind: 'library' });
  assert.equal(tag(null, null), null);
});
