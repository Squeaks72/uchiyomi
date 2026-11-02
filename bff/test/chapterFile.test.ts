import { test } from 'node:test';
process.env.SERIES_IN_NAMES = '1';
import assert from 'node:assert/strict';
import { chapterFileName, chapterFileNames, comicTitle, isOwnFile, OWN_FILE } from '../src/lib/chapterFile';
import { renumberedFile } from '../src/lib/postingOrder';
import { numberByRule } from '../src/lib/naming';

test('a file is named for its series and its chapter', () => {
  assert.equal(chapterFileName('manga/Blue Box', 211), 'Blue Box - Chapter 211.cbz');
  assert.equal(chapterFileName('Weeb Central (EN)/Boruto - Naruto Next Generations', 64), 'Boruto - Naruto Next Generations - Chapter 64.cbz');
  assert.equal(chapterFileName('manga/Blue Box', 84.3), 'Blue Box - Chapter 84.3.cbz');
  // Chapter -1 is read back as 1 (lib/sources/loader.ts), so it keeps the plain name it always had.
  assert.equal(chapterFileName('manga/Blue Box', -1), 'Chapter -1.cbz');
});

test('the name always reads back as its own chapter, and falls back to the plain one when it would not', () => {
  // Digits in the series title: the plain first-number rule would read 1 or 20; the chapter-word rule does not.
  for (const [folder, n] of [['x/Master of the Top 1 Sect', 64], ['x/Ranma 1_2', 4], ['x/20th Century Boys', 3], ['x/Mob Psycho 100', 5]] as const) {
    const name = chapterFileName(folder, n);
    assert.notEqual(name, `Chapter ${n}.cbz`, folder);
    assert.deepEqual(numberByRule(name, 2), { number: n, end: null }, name);
  }
  // A series title that carries a chapter word of its own is read by that word first: keep the plain name.
  assert.equal(chapterFileName('x/Muramata-san no Aijou Ch. 6', 2), 'Chapter 2.cbz');
  assert.equal(chapterFileName('x/Bind Me, Love Me - Chapter 3', 1), 'Chapter 1.cbz');
  // And one too long for a filesystem.
  assert.equal(chapterFileName(`x/${'あ'.repeat(80)}`, 1), 'Chapter 1.cbz');
});

test('both spellings are ours, under any prefix, in the right folder and for the right number only', () => {
  const folder = 'manga/Blue Box';
  assert.ok(isOwnFile('manga/Blue Box/Chapter 5.cbz', folder, 5));
  assert.ok(isOwnFile('manga/Blue Box/Blue Box - Chapter 5.cbz', folder, 5));
  assert.ok(isOwnFile('manga/Blue Box/Old Series Name - Chapter 5.cbz', folder, 5));
  assert.ok(!isOwnFile('manga/Blue Box/Blue Box - Chapter 15.cbz', folder, 5));
  assert.ok(!isOwnFile('manga/Blue Box/Chapter 15.cbz', folder, 5));
  assert.ok(!isOwnFile('manga/Blue Box/Blue Box Chapter 5.cbz', folder, 5));
  assert.ok(!isOwnFile('manga/Other/Blue Box - Chapter 5.cbz', folder, 5));
  assert.ok(!isOwnFile('manga/Blue Box/Chapter 5 (2).cbz', folder, 5));
  assert.ok(!isOwnFile('manga/Blue Box/Official_Chapter 5.cbz', folder, 5));
});

test('lookups by path try the new name first, then the plain one', () => {
  assert.deepEqual(chapterFileNames('manga/Blue Box', 5), ['Blue Box - Chapter 5.cbz', 'Chapter 5.cbz']);
  assert.deepEqual(chapterFileNames('x/Muramata-san no Aijou Ch. 6', 2), ['Chapter 2.cbz']);
});

test('OWN_FILE reads the number out of either spelling', () => {
  assert.equal(OWN_FILE.exec('Chapter 84.3.cbz')?.[1], '84.3');
  assert.equal(OWN_FILE.exec('Boruto - Naruto Next Generations - Chapter 64.cbz')?.[1], '64');
  assert.equal(OWN_FILE.exec('Blue Box - Chapter -1.cbz')?.[1], '-1');
  assert.equal(OWN_FILE.exec('Chapter 7 (2).cbz'), null);
});

test('the ComicInfo title carries the series once', () => {
  assert.equal(comicTitle('Blue Box', '# 211', 211), 'Blue Box - # 211');
  assert.equal(comicTitle('Blue Box', undefined, 211), 'Blue Box - Chapter 211');
  assert.equal(comicTitle('Blue Box', 'Blue Box 211', 211), 'Blue Box 211');
  assert.equal(comicTitle('Blue Box', '  Class 76 ', 76), 'Blue Box - Class 76');
});

test('a renumbered file keeps its series prefix', () => {
  assert.equal(renumberedFile('manga/Blue Box/Blue Box - Chapter 5.cbz', 7), 'manga/Blue Box/Blue Box - Chapter 7.cbz');
  assert.equal(renumberedFile('manga/Blue Box/Blue Box - Chapter 5.cbz', 7, 2), 'manga/Blue Box/Blue Box - Chapter 7 (2).cbz');
  assert.equal(renumberedFile('manga/Blue Box/Chapter 5.cbz', 7), 'manga/Blue Box/Chapter 7.cbz');
  assert.equal(renumberedFile('manga/Blue Box/Vol 2 Ch 5.cbz', 7), 'manga/Blue Box/Chapter 7.cbz');
});

test('with the setting off every name is upstream’s', () => {
  const was = process.env.SERIES_IN_NAMES;
  process.env.SERIES_IN_NAMES = '';
  try {
    assert.equal(chapterFileName('manga/Blue Box', 211), 'Chapter 211.cbz');
    assert.equal(comicTitle('Blue Box', '# 211', 211), '# 211');
    assert.equal(comicTitle('Blue Box', undefined, 211), 'Chapter 211');
    assert.deepEqual(chapterFileNames('manga/Blue Box', 5), ['Chapter 5.cbz']);
    assert.ok(isOwnFile('manga/Blue Box/Blue Box - Chapter 5.cbz', 'manga/Blue Box', 5), 'still recognised');
  } finally {
    process.env.SERIES_IN_NAMES = was;
  }
});
