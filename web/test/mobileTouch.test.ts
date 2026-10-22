// Phone usability (the 2026-10-19 audit): what a finger needs that a mouse does not.
//
// Source-reading tests, like the rest of this suite: each pins a rule whose loss nothing else would notice on a
// desktop and every phone would. The reasons live beside the code; this file only fails when one is dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('fields are 16px, keys and chips have a finger-sized floor, and a modal pins the page, all under pointer: coarse', () => {
  const css = read('app/globals.css');
  const block = css.slice(css.lastIndexOf('@media (pointer: coarse) {'));
  assert.match(block, /textarea \{ font-size: 16px; \}/, 'iOS zooms the page on a field under 16px');
  assert.match(block, /:is\(\.btn-key\) \{ min-height: 2\.5rem; \}/, '.btn-key is 32px tall on a phone again');
  assert.match(block, /:is\(\.chip\) \{ min-height: 2\.25rem; \}/, '.chip is 28px tall on a phone again');
  assert.match(block, /html:has\(\[role='dialog'\]\[aria-modal='true'\]\) \{ overflow: hidden; \}/, 'the page scrolls behind an open dialog');
});

test('sheets and dialogs measure the VISIBLE viewport (dvh) and do not raise the keyboard on open', () => {
  const ui = read('components/ui.tsx');
  assert.doesNotMatch(ui, /max-h-\[(75|85)vh\]/, 'a sheet is sized in vh: taller than the screen under Safari\'s toolbar');
  assert.match(ui, /coarsePointer\(\) \? panel/, 'a sheet focuses its first field on a phone');
  const dlg = read('components/ConfirmDialog.tsx');
  assert.match(dlg, /fieldFirst\.current && !coarsePointer\(\)/, 'a dialog focuses its field on a phone, under the keyboard');
  assert.doesNotMatch(read('components/ProfileMenu.tsx'), /100vh/, 'the profile menu is sized in vh');
});

test('the long-press menu survives the URL bar sliding away and a scroll inside itself', () => {
  const m = read('components/ContextMenu.tsx');
  assert.match(m, /if \(window\.innerWidth !== w0\) away\(\)/, 'a height-only resize closes the menu');
  assert.match(m, /ref\.current\?\.contains\(e\.target\)/, 'scrolling the menu closes it');
});

test('the reader: a zoomed page can be panned, a fling is not a tap, the bar stays while you drag the slider', () => {
  const r = read('app/reader/page.tsx');
  assert.match(r, /touch-pan-x touch-pan-y overflow-x-auto/, 'a zoomed webtoon column cannot be panned sideways by touch');
  assert.match(r, /zoom > 1 \? 'touch-none overflow-x-hidden' : 'touch-pan-x overflow-x-auto'/, 'a zoomed paged page turns instead of panning');
  assert.match(r, /panBy\(e\.clientX - before\.x, e\.clientY - before\.y\)/, 'paged zoom has no drag');
  assert.match(r, /caughtFling\.current = e\.pointerType === 'touch' && isCatch\(/, 'stopping a fling toggles the controls');
  assert.match(r, /if \(!chrome \|\| showSettings \|\| scrubbing\) return;/, 'the bar hides under a finger on the slider');
  assert.match(r, /pointer-events-none absolute inset-x-0 top-0 z-40[^"]*\[&>\*\]:pointer-events-auto/, 'the top bar\'s gradient swallows taps again');
  assert.match(r, /safe-area-inset-left/, 'the bars sit under the notch in landscape');
  assert.match(read('components/ReaderPage.tsx'), /onClick=\{retry\} onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/, 'retrying a page also turns it');
});

test('a finger\'s double-tap is decided by the pointer path alone, not by the browser\'s dblclick', () => {
  // The synthesized dblclick after two edge taps zoomed the page right after the gesture module had said "two taps".
  assert.match(read('app/reader/page.tsx'), /if \(lastPointer\.current !== 'mouse'\) return;/, 'a touch double-tap raises dblclick and zooms from an edge');
});

test('the series list brings the unread chapter into view once, and a revoke/role/disable needs a second press on a phone', () => {
  const s = read('app/series/page.tsx');
  assert.match(s, /arrivedAt\.current === id\) return;/, 'the unread chapter is not scrolled to');
  assert.match(s, /document\.getElementById\(`ch-\$\{resumeBook\.number\}`\)/, 'the scroll target is not the resume row');
  assert.match(read('components/ArmButton.tsx'), /export function ConfirmKey/, 'ConfirmKey is gone');
  assert.match(read('app/admin/page.tsx'), /<ConfirmKey onConfirm=\{\(\) => revoke\(s\.id\)\}/, 'Revoke fires on one mis-tap');
});

test('the reader\'s page slider spans the chapter being read, not every chapter the column has loaded', () => {
  const r = read('app/reader/page.tsx');
  assert.match(r, /<input type="range" min=\{chapRange\.lo\} max=\{chapRange\.hi\} value=\{Math\.min\(Math\.max\(current, chapRange\.lo\), chapRange\.hi\)\}/, 'the slider runs over every loaded chapter again');
  assert.match(r, /while \(lo > 0 && flat\[lo - 1\]\.ci === sliderCi\) lo--;/, 'the chapter\'s first page is not found');
});

test('between chapters: the webtoon column has a visible break, and paged mode names the chapter it just crossed into', () => {
  const page = read('components/ReaderPage.tsx');
  assert.match(page, /export const DIVIDER_H = 168;/, 'the divider is a thin line again');
  assert.match(page, /data-chapter-divider/, 'the divider has no band of its own');
  assert.match(page, /tr\('End of \{chapter\}', \{ chapter: dividerPrev \}\)/, 'the divider does not say the chapter ended');
  const r = read('app/reader/page.tsx');
  assert.match(r, /dividerPrev=\{p\.firstOfChapter && p\.ci > 0/, 'the previous chapter is not handed to the divider');
  assert.match(r, /data-chapter-note/, 'paged mode says nothing when a chapter changes');
  assert.match(r, /if \(was === null \|\| was === id \|\| prefs\.mode !== 'paged'\) return;/, 'the note shows on the first chapter or in the column');
});
