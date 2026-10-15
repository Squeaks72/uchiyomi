// Text colours must be readable on the surfaces they sit on (WCAG 2.2 AA, 4.5:1 for text).
//
// fog-500 / fog-600 carry the app's secondary text -- about 600 uses -- and used to measure 3.5 and 2.3 on the
// card surfaces. Raising them was one edit to the theme; this pins it so a later "make it subtler" edit fails
// here rather than in a user's eyes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { contrastRatio, readableAccent } from '../lib/theme';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const hex = (name: string): [number, number, number] => {
  const m = css.match(new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`));
  assert.ok(m, `${name} is defined in the theme`);
  const h = m![1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

// The surfaces text really sits on. ink-600 is a border and hover colour, not a surface for text.
const SURFACES = ['ink-950', 'ink-900', 'ink-850', 'ink-800', 'ink-700'];

for (const fog of ['fog-50', 'fog-100', 'fog-200', 'fog-300', 'fog-400', 'fog-500', 'fog-600']) {
  test(`${fog} is at least 4.5:1 on every surface`, () => {
    for (const s of SURFACES) {
      const r = contrastRatio(hex(fog), hex(s));
      assert.ok(r >= 4.5, `${fog} on ${s} is ${r.toFixed(2)}:1`);
    }
  });
}

test('readableAccent: every preset accent is readable as text on ink-700', () => {
  for (const a of ['#7c5cff', '#22d3ee', '#34d399', '#fb7185', '#f59e0b', '#60a5fa', '#000000', '#1e3a8a']) {
    const t = readableAccent(a)!.split(' ').map(Number) as [number, number, number];
    assert.ok(contrastRatio(t, hex('ink-700')) >= 5, `${a} -> ${t}`);
  }
});

test('readableAccent: a bright accent is returned unchanged, junk is null', () => {
  assert.equal(readableAccent('#22d3ee'), '34 211 238');
  assert.equal(readableAccent('nope'), null);
});

test('the zoom lock is gone: pinch-zoom is allowed', () => {
  const layout = readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
  assert.doesNotMatch(layout, /userScalable\s*:\s*false|maximumScale/);
});

test('there is a skip link to the main landmark, and a global focus ring', () => {
  const shell = readFileSync(join(__dirname, '..', 'components', 'AppShell.tsx'), 'utf8');
  assert.match(shell, /href="#main"/);
  assert.match(shell, /<main id="main"/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  assert.match(css, /forced-colors:\s*active/);
});
