// "Notify only when a preferred group releases": the pure part. The updater counts the chapters of a sweep that are
// worth telling anybody about; the fetch itself is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { notifiableCount } from '../src/lib/releases';

const landed = [
  { scanlator: 'Asura Scans' },
  { scanlator: 'Some Scanlation Group' },
  { scanlator: 'Flame & Asura Scans' },
  { scanlator: null },
];

test('off: every chapter that landed is news', () => {
  assert.equal(notifiableCount(landed, ['Asura Scans'], false), 4);
});

test('on: only chapters from a preferred group, spelled however the source spells it', () => {
  assert.equal(notifiableCount(landed, ['Asura Scans'], true), 2, 'the exact group and a joint release that includes it');
  assert.equal(notifiableCount(landed, ['asura-scans'], true), 2, 'case and punctuation do not matter');
  assert.equal(notifiableCount([{ scanlator: 'Other' }], ['Asura Scans'], true), 0, 'a chapter from another group is not announced');
  assert.equal(notifiableCount([{ scanlator: null }], ['Asura Scans'], true), 0, 'a chapter with no group is not a preferred one');
});

test('on, with no preferred group: nothing to be picky about, so everything is news (never a silent mute)', () => {
  assert.equal(notifiableCount(landed, [], true), 4);
  assert.equal(notifiableCount(landed, ['   '], true), 4);
});

test('a source that lists groups as an array is read from it', () => {
  assert.equal(notifiableCount([{ scanlator: 'x', groups: ['Asura Scans', 'Other'] }], ['Asura Scans'], true), 1);
});

test('a source filter keeps only chapters delivered by a ticked source, and combines with the group filter', () => {
  const l = [
    { scanlator: 'Asura Scans', source: 'mangadex' },
    { scanlator: 'Asura Scans', source: 'weebcentral' },
    { scanlator: 'Other', source: 'mangadex' },
    { scanlator: 'Other', source: null },
  ];
  assert.equal(notifiableCount(l, [], false, ['mangadex']), 2, 'only the source asked for');
  assert.equal(notifiableCount(l, [], false, []), 4, 'no source ticked is no filter');
  assert.equal(notifiableCount(l, ['Asura Scans'], true, ['mangadex']), 1, 'both filters must hold');
  assert.equal(notifiableCount(l, ['Asura Scans'], true, ['weebcentral', 'mangadex']), 2);
  assert.equal(notifiableCount(l, [], false, ['gone']), 0, 'a ticked source that delivered nothing here is silence');
});

test('an upgrade to a preferred group is announced for a series set to notify only for a preferred group, and nothing else changes', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const src = readFileSync(join(__dirname, '..', 'src/lib/repair.ts'), 'utf8');
  assert.match(src, /await announceUpgrades\(upgraded\)/, 'the group step announces nothing');
  assert.match(src, /if \(sp\?\.notifyOnlyPreferred !== true\) continue;/, 'every series is told about upgrades, which nobody asked for');
  assert.match(src, /notifiableCount\(\[i\], eff\.priority, sp\?\.notifyOnlyPreferred === true, sp\?\.notifySources \?\? \[\]\)/, 'the source filter has no say');
  assert.match(src, /u\.items\.push\(\{ number: Number\(book\.number\)/, 'the run does not note what it upgraded');
});
