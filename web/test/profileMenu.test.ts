// The profile photo opens quick settings (components/ProfileMenu.tsx) instead of navigating.
// Source-grep style, like the other component tests: the pieces that must not drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('the avatar is a labelled popup button, and the header uses it', () => {
  const menu = code(read('components/ProfileMenu.tsx'));
  assert.match(menu, /aria-label=\{tr\('Profile'\)\}/);
  assert.match(menu, /aria-haspopup="dialog"/);
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(code(read('components/TopNav.tsx')), /<ProfileMenu active=/);
});

test('the popup closes on Escape and outside press, hands focus back, scrolls with Lenis opted out', () => {
  const menu = code(read('components/ProfileMenu.tsx'));
  assert.match(menu, /e\.key === 'Escape'/);
  assert.match(menu, /'pointerdown'/);
  assert.match(menu, /btn\.current\?\.focus/);
  assert.match(menu, /trapTab\(e, panel\.current\)/);
  assert.match(menu, /data-lenis-prevent/);
  assert.doesNotMatch(menu, /\b(?:left|right)-\d|\bm[lr]-\d|\bp[lr]-\d|text-(?:left|right)/, 'physical-direction classes break rtl');
});

test('it reuses the existing state, not copies of it', () => {
  const menu = code(read('components/ProfileMenu.tsx'));
  assert.match(menu, /useIncognito\(\)/);
  assert.match(menu, /INCOGNITO_TEXT\[0\]/);
  assert.match(menu, /useAccountPref\('showBanners'\)/);
  assert.match(menu, /useAccountPref\('compactChapters'\)/);
  // 18+ renders nothing for an account with no 18+ library or filter, as AdultToggle does.
  assert.match(menu, /showAdult && \(/);
  assert.match(menu, /\.some\(\(l\) => l\.adult\)/);
  assert.match(menu, /href="\/profile"/, 'the Profile route stays reachable');
  assert.match(menu, /\{tr\('Sign out'\)\}/);
});

test('the phone reaches the same body from the More sheet', () => {
  assert.match(code(read('components/MoreSheet.tsx')), /QuickSettingsSheet/);
});
