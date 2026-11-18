// Ongoing as far as anyone can tell (lib/activity.ts seriesLikelyOngoing): what decides "Notify me" over "Read again".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { seriesLikelyOngoing } from '../lib/activity';

const now = Date.parse('2026-11-18T00:00:00Z');
const daysAgo = (d: number) => new Date(now - d * 86400_000).toISOString();

test('a status that says so decides', () => {
  assert.equal(seriesLikelyOngoing('Ongoing', null, now), true);
  assert.equal(seriesLikelyOngoing('ONGOING', daysAgo(900), now), true);
  assert.equal(seriesLikelyOngoing('Completed', daysAgo(1), now), false);
  assert.equal(seriesLikelyOngoing('Publishing finished', daysAgo(1), now), false);
});

test('no status, or Unknown: a chapter in the last half year makes it ongoing', () => {
  for (const s of [null, undefined, '', 'Unknown']) {
    assert.equal(seriesLikelyOngoing(s, daysAgo(20), now), true, String(s));
    assert.equal(seriesLikelyOngoing(s, daysAgo(400), now), false, String(s));
    assert.equal(seriesLikelyOngoing(s, null, now), false, String(s));
  }
});

test('caught up on an ongoing series, the page offers Subscribe instead of the reading button', () => {
  const src = readFileSync(join(__dirname, '..', 'app/series/page.tsx'), 'utf8');
  // 2026-11-18 later: the one-shot watch became Subscribe.
  assert.match(src, /reading\.kind === 'caughtup' && reading\.book\s*\? <SubscribeButton seriesId=\{id\} waitingFor=\{Math\.floor\(reading\.book\.number\) \+ 1\} \/>/);
  assert.match(src, /reading\.kind === 'caughtup' && reading\.book\s*\? <SubscribeButton compact seriesId=\{id\}/);
  assert.match(src, /<SubscribeButton keyShape seriesId=\{id\} \/>/, 'no Subscribe key beside Favourite');
  assert.match(src, /seriesLikelyOngoing\(series\?\.metadata\?\.status, newest\)/);
});
