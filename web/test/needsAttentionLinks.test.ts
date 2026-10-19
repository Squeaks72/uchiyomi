// Admin → Overview → Needs attention: every finding is a way to the card that fixes it.
//
// The tiles were inert <div>s: they said what was wrong and left the admin to find the Health tab, the
// right card and open it. Each is a button now; it switches to Health and opens that check's card in view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'app/admin/page.tsx'), 'utf8');

test('each Needs attention tile is a button that opens its check in Health', () => {
  const tile = src.slice(src.indexOf('function NeedsAttention('), src.indexOf('/** A navigational tile'));
  assert.match(tile, /<button key=\{c\.id\} type="button" onClick=\{\(\) => onOpen\(c\.id\)\}/, 'the tile is not a button that opens its check');
  assert.doesNotMatch(tile, /<div key=\{c\.id\}/, 'the tile is an inert div again');
  assert.match(src, /const openCheck = \(id: string\) => \{ setFocusCheck\(id\); setTab\('Health'\); \};/, 'the tile does not switch to Health');
  assert.match(src, /<Overview onTab=\{setTab\} onCheck=\{openCheck\} \/>/, 'Overview is not handed the opener');
  assert.match(src, /<HealthFocus\.Provider value=\{\{ id: focusCheck, done: \(\) => setFocusCheck\(null\) \}\}><Health \/><\/HealthFocus\.Provider>/, 'Health is not told which card to open');
});

test('Health opens the chosen card once its report has loaded', () => {
  const health = src.slice(src.indexOf('function Health('));
  assert.match(health, /if \(!focus \|\| !data\) return;\s+showCheck\(focus\);\s+onFocused\(\);/, 'Health does not open the card it was sent to');
});
