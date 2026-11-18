// Compare a chapter file with another source's copy, then replace it. Read from source, like seriesPage.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

test('Replace from another source is gone: a copy is endorsed from its version row or the versions sheet (2026-11-18)', () => {
  // The owner retired the row's "Replace from another source…" and its compare: the version rows' menu endorses a copy instead
  // (bff lib/endorse.ts), and the versions sheet's key is Endorse. The compare dialog stays, unused by the series page.
  const src = read('app/series/page.tsx');
  assert.doesNotMatch(src, /Replace from another source/);
  assert.doesNotMatch(src, /<CompareCopiesDialog /);
  assert.match(src, /label: tr\('Endorse this version'\)/);
  assert.match(src, /onReplace=\{\(copy\) => \{ const n = chapterSheet\.number; setChapterSheet\(null\); void endorse\(n, copy\.source\); \}\}/);
  assert.match(read('components/ChapterVersionsSheet.tsx'), /data-endorse-version>\{tr\('Endorse'\)\}/);
});

test('the dialog reads the copy through the admin routes and changes nothing itself', () => {
  const cmp = read('components/CompareCopiesDialog.tsx');
  assert.match(cmp, /copy-pages\?source=/);
  assert.match(cmp, /copy-page\?source=/);
  assert.match(cmp, /data-compare-replace/);
  assert.doesNotMatch(cmp, /method: 'POST'/);
});

test('the arrows follow the reading direction, and the keys mirror with the row (#241)', () => {
  const cmp = read('components/CompareCopiesDialog.tsx');
  assert.match(cmp, /const forward = rtl \? 'ArrowLeft' : 'ArrowRight';/, 'ArrowRight goes on in Arabic too');
  assert.match(cmp, /const back = rtl \? 'ArrowRight' : 'ArrowLeft';/);
  assert.equal((cmp.match(/className="inline-block rtl:-scale-x-100">[‹›]<\/span>/g) ?? []).length, 2, 'a ‹ › key does not mirror right to left');
});
