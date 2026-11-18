// "dandadan 213" (lib/chapterQuery.ts): a title and a chapter number out of one search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { foldTitle, parseChapterQuery, titleIsWholeQuery } from '../lib/chapterQuery';

test('a title then a number asks for that chapter, however the number is introduced', () => {
  for (const q of ['dandadan 213', 'Dandadan ch 213', 'dandadan ch.213', 'dandadan Chapter 213', 'dandadan chap 213', 'dandadan #213', 'dandadan c213', '  dandadan   213  ', 'dandadan - 213', 'dandadan: 213']) {
    const r = parseChapterQuery(q);
    assert.deepEqual(r && { title: r.title.toLowerCase(), number: r.number }, { title: 'dandadan', number: 213 }, q);
  }
  assert.deepEqual(parseChapterQuery('one piece 1154.5'), { title: 'one piece', number: 1154.5 });
  assert.deepEqual(parseChapterQuery('chainsaw man 8'), { title: 'chainsaw man', number: 8 });
});

test('no chapter without a title before the number, or without a number at the end', () => {
  for (const q of ['213', 'ch 213', '#5', 'a 1', 'dandadan', 'dandadan ch', 'ch dandadan', '']) assert.equal(parseChapterQuery(q), null, q);
});

test('a title that ends in a number is still a candidate, and the whole-title check says when it is the title', () => {
  assert.deepEqual(parseChapterQuery('kaiju no. 8'), { title: 'kaiju no', number: 8 });
  assert.ok(titleIsWholeQuery('kaiju no. 8', ['Kaiju No. 8']));
  assert.ok(titleIsWholeQuery('mob psycho 100', ['Mob Psycho 100']));
  assert.ok(!titleIsWholeQuery('dandadan 213', ['Dandadan']));
  assert.equal(foldTitle('Pokémon: Adventures!'), 'pokemon adventures');
});

test('the palette offers the chapter rows and opens them where they belong', () => {
  const src = readFileSync(join(__dirname, '..', 'components/CommandPalette.tsx'), 'utf8');
  assert.match(src, /parseChapterQuery\(query\)/);
  assert.match(src, /\/api\/series\/\$\{encodeURIComponent\(s\.id\)\}\/chapter\?n=/);
  assert.match(src, /go\(`\/reader\/\?book=\$\{r\.bookId\}`\)/);
  assert.match(src, /go\(`\/series\/\?id=\$\{r\.series\.id\}&ch=\$\{r\.number\}`\)/);
});
