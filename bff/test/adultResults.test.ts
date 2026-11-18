// Show 18+ off: each source result judged on its own (lib/adultResults.ts judgeResult).
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeResult } from '../src/lib/adultResults';

const lists = { genres: ['Ecchi'], sources: ['sw:adultsite'] };
const plain = { id: 'sw:plain', isNsfw: false };
const flagged = { id: 'sw:aggregator', isNsfw: true };

test('explicit genres and title words make a result adult, whatever the source says', () => {
  assert.equal(judgeResult({ title: 'Some Title', genres: ['Action', 'Hentai'] }, plain, lists), 'adult');
  assert.equal(judgeResult({ title: 'Uncensored Night', genres: [] }, plain, lists), 'adult');
  assert.equal(judgeResult({ title: 'X', genres: ['ecchi'] }, plain, lists), 'adult', 'the admin list, folded');
  assert.equal(judgeResult({ title: 'X' }, { id: 'sw:adultsite' }, lists), 'adult', 'a source the admin rated adult');
  assert.equal(judgeResult({ title: 'X', contentRating: 'pornographic' }, plain, lists), 'adult');
});

test('ordinary titles are not caught by the word list', () => {
  for (const t of ['Adulthood Is Hard', 'The Pornographic Detective? no', 'Erased', 'Hentai Prince and the Stony Cat']) {
    const j = judgeResult({ title: t, genres: ['Comedy'] }, plain, lists);
    if (t.startsWith('Hentai Prince')) assert.equal(j, 'adult', 'a title word is a title word');
    else if (t.includes('Pornographic')) assert.equal(j, 'safe');
    else assert.equal(j, 'safe', t);
  }
});

test('a self-declared NSFW source with nothing else said is flagged, not safe; MangaDex safe ratings are safe', () => {
  assert.equal(judgeResult({ title: 'Solo Leveling' }, flagged, lists), 'flagged');
  assert.equal(judgeResult({ title: 'Solo Leveling', contentRating: 'safe' }, plain, lists), 'safe');
  assert.equal(judgeResult({ title: 'Solo Leveling' }, plain, lists), undefined);
});
