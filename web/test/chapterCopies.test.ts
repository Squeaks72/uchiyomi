// A chapter's copies on the series page (lib/chapterCopies.ts): which is endorsed, colored, the one this account reads, and the pick to send.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ALL_GROUPS } from '../lib/groupFilter';
import { COLORED_SOURCE, ENDORSED_PICK, copiesForGroup, copiesOf, pickFor } from '../lib/chapterCopies';

const book = { sourceId: 'mp', scanlator: 'MANGA Plus', media: { pagesCount: 17 } };
const kept = [{ sourceId: 'viz', pages: 18, scanlator: 'VIZ Media' }, { sourceId: 'tcb', pages: 19, scanlator: 'TCB Scans' }];
const names = { mp: 'MANGA Plus', viz: 'VIZ', tcb: 'TCB' };
const ctx = { names, coloredSource: null, mySource: null };

test('the endorsed copy comes first, then the kept ones by source name, each with its group and pages', () => {
  const c = copiesOf(book, kept, ctx);
  assert.deepEqual(c.map((x) => [x.sourceId, x.sourceName, x.group, x.pages, x.endorsed]), [
    [null, 'MANGA Plus', 'MANGA Plus', 17, true], ['tcb', 'TCB', 'TCB Scans', 19, false], ['viz', 'VIZ', 'VIZ Media', 18, false]]);
});

test('a kept row from the endorsed copy’s own source is not listed twice', () => {
  assert.equal(copiesOf(book, [...kept, { sourceId: 'mp', pages: 17 }], ctx).length, 3);
});

test('exactly one copy is read: the chapter pick, else the series source, else the endorsed one', () => {
  const reading = (c: ReturnType<typeof copiesOf>) => c.filter((x) => x.reading).map((x) => x.sourceId);
  assert.deepEqual(reading(copiesOf(book, kept, ctx)), [null]);
  assert.deepEqual(reading(copiesOf(book, kept, { ...ctx, mySource: 'viz' })), ['viz']);
  assert.deepEqual(reading(copiesOf(book, kept, { ...ctx, mySource: 'viz', pick: 'tcb' })), ['tcb']);
  assert.deepEqual(reading(copiesOf(book, kept, { ...ctx, mySource: 'viz', pick: ENDORSED_PICK })), [null]);
  // A source with no kept copy of this chapter falls back to the endorsed file, as the server does.
  assert.deepEqual(reading(copiesOf(book, kept, { ...ctx, mySource: 'gone' })), [null]);
});

test('the colored edition is marked, a followed source or the reserved key alike', () => {
  assert.deepEqual(copiesOf(book, kept, { ...ctx, coloredSource: 'viz' }).filter((x) => x.colored).map((x) => x.sourceId), ['viz']);
  assert.deepEqual(copiesOf(book, kept, { ...ctx, coloredSource: 'mp' }).filter((x) => x.colored).map((x) => x.sourceId), [null]);
  const col = copiesOf(book, [{ sourceId: COLORED_SOURCE, pages: 17 }], { ...ctx, coloredSource: COLORED_SOURCE, coloredName: 'MangaDex' });
  assert.deepEqual(col.map((x) => [x.sourceName, x.colored]), [['MANGA Plus', false], ['MangaDex', true]]);
});

test('the pick stores nothing when the series choice already serves the copy', () => {
  const [endorsed, tcb, viz] = copiesOf(book, kept, ctx);
  const ks = ['tcb', 'viz'];
  assert.equal(pickFor(endorsed, null, ks), null);
  assert.equal(pickFor(endorsed, 'viz', ks), ENDORSED_PICK);
  assert.equal(pickFor(endorsed, 'gone', ks), null);
  assert.equal(pickFor(tcb, null, ks), 'tcb');
  assert.equal(pickFor(viz, 'viz', ks), null);
});

test('the group filter keeps the copies of that group', () => {
  const c = copiesOf(book, kept, ctx);
  assert.equal(copiesForGroup(c, ALL_GROUPS).length, 3);
  assert.deepEqual(copiesForGroup(c, 'tcb scans').map((x) => x.sourceId), ['tcb']);
});

test('the series page draws the copies under the chapter, and the bar has the group filter', () => {
  const src = readFileSync(join(__dirname, '..', 'app/series/page.tsx'), 'utf8');
  assert.match(src, /below=\{accordion \? <CopyRows copies=\{copies\}/);
  assert.match(src, /\/api\/books\/\$\{encodeURIComponent\(b\.id\)\}\/my-version/);
  assert.match(src, /data-group-filter/);
});
