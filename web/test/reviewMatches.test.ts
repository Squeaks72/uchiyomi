// A finished review-first search leads somewhere from the Health row that started it,
// and the 18+ filter does not apply to admin tooling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { reviewIdsFor, type FindRun } from '../lib/findSources';
import { withAdult } from '../lib/adult';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const prop = (state?: string) => ({ sourceId: 's', name: 'S', ...(state ? { state } : {}) }) as any;
const run = (over: Partial<FindRun> = {}): FindRun => ({
  id: 'r1', status: 'done', total: 3, done: 3, followed: 0, startedBy: null, startedAt: 0, review: true,
  results: [
    { seriesId: 'a', title: 'A', followed: [], proposals: [prop()] },
    { seriesId: 'b', title: 'B', followed: [], proposals: [prop('skipped')] },
    { seriesId: 'c', title: 'C', followed: [], why: 'no_match' },
  ],
  ...over,
} as any);

test('reviewIdsFor: the series of the row that still wait, for a finished review-first run only', () => {
  assert.deepEqual(reviewIdsFor(run(), { seriesId: 'a', findScope: 'series' }), ['a']);
  assert.deepEqual(reviewIdsFor(run(), { seriesId: 'b', findScope: 'series' }), [], 'every match decided');
  assert.deepEqual(reviewIdsFor(run(), { seriesId: 'c', findScope: 'series' }), [], 'nothing found');
  assert.deepEqual(reviewIdsFor(run({ status: 'running' }), { seriesId: 'a', findScope: 'series' }), []);
  assert.deepEqual(reviewIdsFor(run({ review: false }), { seriesId: 'a', findScope: 'series' }), []);
  assert.deepEqual(reviewIdsFor(run({ mode: 'replace' }), { seriesId: 'a', findScope: 'series' }), [], 'a Replace run is reviewed in its own dialog');
  assert.deepEqual(reviewIdsFor(null, { seriesId: 'a', findScope: 'series' }), []);
});

test('reviewIdsFor: a source row gets every waiting series of its own source run', () => {
  assert.deepEqual(reviewIdsFor(run({ sourceId: 'x' }), { sourceId: 'x' }), ['a']);
  assert.deepEqual(reviewIdsFor(run({ sourceId: 'y' }), { sourceId: 'x' }), [], 'another source’s run');
});

test('the Health row opens the review from a key of its own', () => {
  const src = read('components/HealthActions.tsx');
  assert.match(src, /reviewIdsFor\(reviewRun, item\)/);
  assert.match(src, /data-health-action="review_matches"/);
  assert.match(src, /<RunReviewSheet runId=\{reviewRun\.id\} ids=\{reviewIds\}/);
  assert.equal((src.match(/\{reviewKey\}/g) ?? []).length, 2, 'in the compact row and the full one');
});

