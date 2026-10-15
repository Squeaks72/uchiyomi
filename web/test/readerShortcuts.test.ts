// The reader's keyboard-shortcuts list (components/ReaderShortcuts.tsx): opened by a toolbar button and by ?, listing the keys in force.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, '..', 'app/reader/page.tsx'), 'utf8');
const list = readFileSync(join(__dirname, '..', 'components/ReaderShortcuts.tsx'), 'utf8');

test('? opens the list, and while it is open ? and Escape close it and no other key reaches the pages', () => {
  assert.match(page, /e\.key === '\?' && !\/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/[\s\S]{0,200}setShowKeys\(true\)/);
  assert.match(page, /if \(showSettings \|\| showPages \|\| showChapters \|\| showKeys\) \{[\s\S]{0,300}setShowKeys\(false\)[\s\S]{0,200}return;/);
  assert.match(page, /showSettings \|\| showPages \|\| showChapters \|\| showKeys\);/, 'a game controller waits while it is open');
});

test('the list reads the keys in force, not a copy of the defaults', () => {
  assert.match(page, /<ReaderShortcuts keyMap=\{keyMap\}/);
  assert.match(list, /READER_ACTIONS\.filter\(\(a\) => a !== 'exit' && keyMap\[a\]\.length > 0\)/);
});

test('the toolbar button is for a pointer that hovers and is fine, not a phone', () => {
  assert.match(list, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(page, /\{hasKeyboard && \(\s*<button onClick=\{\(\) => setShowKeys\(true\)\}/);
});

test('the reader has its own right-click menu: the mouse only, and the keys are the menu\'s while it is open', () => {
  assert.match(page, /const readerMenu = useContextMenu\(\(\): MenuItem\[\] =>/);
  // Both tracks open it; the hook's touch long-press is not spread, so taps and holds are the reader's.
  assert.equal((page.match(/onDoubleClick=\{onTrackDoubleClick\} \{\.\.\.menuBind\}/g) ?? []).length, 2);
  assert.doesNotMatch(page, /\{\.\.\.readerMenu\.bind\}/);
  // Escape in an open menu closes the menu, not the reader.
  assert.match(page, /if \(menuOpen\.current\) return;[\s\S]{0,1200}if \(e\.key === 'Escape'\) \{ if \(!e\.repeat\) back\(\)/);
});
