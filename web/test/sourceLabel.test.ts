import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceWithLang } from '../lib/sourceLabel';

test('the language is added after a name that lacks one, and never repeated after one that has it', () => {
  assert.equal(sourceWithLang('Toonily', 'en'), 'Toonily (EN)');
  assert.equal(sourceWithLang('MangaDex (PT-BR)', 'pt-BR'), 'MangaDex (PT-BR)', 'the doubled "(PT-BR) (PT-BR)"');
  assert.equal(sourceWithLang('Weeb Central (EN)', 'en'), 'Weeb Central (EN)');
  assert.equal(sourceWithLang('3Hentai (ALL)', 'all'), '3Hentai (ALL)');
  assert.equal(sourceWithLang('MangaDex (ES-419)', 'es-419'), 'MangaDex (ES-419)');
  assert.equal(sourceWithLang('Manga (Reader)', 'en'), 'Manga (Reader) (EN)', 'brackets that are part of a name are not a language tag');
  assert.equal(sourceWithLang('Site', null), 'Site');
});
