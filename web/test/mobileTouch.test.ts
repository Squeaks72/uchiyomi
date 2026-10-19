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
  assert.doesNotMatch(read('components/ConsoleNav.tsx'), /max-h-\[80vh\]/, 'the group sheet is sized in vh');
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
