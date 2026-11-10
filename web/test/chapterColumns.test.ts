// The chapter list's column width follows the titles on the page, within limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAPTER_COL_MAX, CHAPTER_COL_MIN, chapterColumnWidth, rowChrome } from '../lib/chapterColumns';

test('short titles keep the old 250 px column; long ones widen it; nothing passes the limit', () => {
  assert.equal(chapterColumnWidth(60, rowChrome(false)), CHAPTER_COL_MIN, 'short titles are not given more room than they need');
  assert.equal(chapterColumnWidth(0, rowChrome(false)), CHAPTER_COL_MIN, 'nothing measured (no canvas) is the old column');
  assert.equal(chapterColumnWidth(Number.NaN, 168), CHAPTER_COL_MIN);
  assert.equal(chapterColumnWidth(260, 168), 428, 'a 260 px title plus the row\'s thumbnail and buttons');
  assert.equal(chapterColumnWidth(2000, 168), CHAPTER_COL_MAX, 'a very long title stops at the limit');
  assert.equal(CHAPTER_COL_MAX, 720);
});

test('the compact list on a pointer needs less around the words', () => {
  assert.ok(rowChrome(true) < rowChrome(false));
});

test('the page measures its titles into --chap-col, and the grid reads it', () => {
  const page = readFileSync(join(__dirname, '..', 'app/series/page.tsx'), 'utf8');
  assert.match(page, /textWidth\(title, 14\), textWidth\(caption, 11\)/, 'the titles are not measured');
  assert.match(page, /'--chap-col': `\$\{colW\}px`/, 'the measured width does not reach the grid');
  assert.match(page, /colW > CHAPTER_COL_STRETCH \? \{ '--chap-max'/, 'long titles do not cap the column');
  assert.match(readFileSync(join(__dirname, '..', 'lib/chapterView.ts'), 'utf8'), /minmax\(min\(var\(--chap-col,250px\),100%\),var\(--chap-max,1fr\)\)/, 'the grid ignores --chap-col');
});
