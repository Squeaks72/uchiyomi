// A chapter's copies on the series page (lib/chapterCopies.ts): which is endorsed, colored, the one this account reads, and the pick to send.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ALL_GROUPS } from '../lib/groupFilter';
import { COLORED_SOURCE, ENDORSED_PICK, cleanGroup, copiesForGroup, copiesOf, endorsedOrigin, pickFor } from '../lib/chapterCopies';
import type { VersionCopy } from '../lib/types';

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

const listed = (source: string, o: Partial<VersionCopy> = {}): VersionCopy => ({
  key: `${source}:1`, source, sourceName: source.toUpperCase(), groups: [], scanlator: null, lang: null, pages: null, publishedAt: null,
  chosen: false, blocked: false, onDisk: false, ...o,
});

test('a file with no group recorded takes the group and source of the listed copy it was matched to', () => {
  const imported = { sourceId: null, scanlator: null, media: { pagesCount: 26 } };
  const copies = [listed('off', { scanlator: 'Official', groups: ['Official'], onDisk: true, chosen: true }), listed('cmk', { scanlator: '\u200b', pages: 27 })];
  assert.deepEqual(endorsedOrigin(imported, copies), { sourceId: 'off', group: 'Official' });
  const c = copiesOf(imported, [], { ...ctx, names: { off: 'Official src' } }, copies);
  assert.deepEqual(c.map((x) => [x.sourceId, x.held, x.sourceName, x.group, x.pages]), [[null, true, 'Official src', 'Official', 26], ['cmk', false, 'CMK', null, 27]]);
});

test('listed copies not held come after the held ones, one per source, never another language or a source already here', () => {
  const c = copiesOf(book, kept, ctx, [
    listed('mp', { onDisk: true }), listed('viz'), listed('new', { scanlator: 'New Scans' }), listed('new', { scanlator: 'Other' }),
    listed('fr', { otherLanguage: 'fr' }),
  ]);
  assert.deepEqual(c.map((x) => [x.sourceId, x.held]), [[null, true], ['tcb', true], ['viz', true], ['new', false]]);
  assert.equal(c[3].group, 'New Scans');
});

test('a blank group is no group', () => {
  assert.equal(cleanGroup('\u200b'), null);
  assert.equal(cleanGroup('  '), null);
  assert.equal(cleanGroup(' TCB '), 'TCB');
});

test('the series page draws the copies under the chapter, and the bar has the group filter', () => {
  const src = readFileSync(join(__dirname, '..', 'app/series/page.tsx'), 'utf8');
  assert.match(src, /below=\{accordion \? <CopyRows copies=\{copies\}/);
  assert.match(src, /\/api\/books\/\$\{encodeURIComponent\(b\.id\)\}\/my-version/);
  assert.match(src, /data-group-filter/);
  assert.match(src, /\/api\/series\/\$\{encodeURIComponent\(id\)\}\/versions\/fetch/);
  assert.match(src, /aria-expanded=\{!!expanded\} data-copies-toggle/);
  assert.match(src, /group=\{endorsedOrigin\(b, versionsOf\.get\(b\.number\)\)\.group\}/);
});

test('each copy carries its own source’s title for the chapter', () => {
  const b = { sourceId: 'mp', scanlator: null, chapterName: 'From the file', media: { pagesCount: 19 } };
  const c = copiesOf(b, [{ sourceId: 'viz', pages: 18 }], ctx, [
    listed('mp', { onDisk: true, title: 'Ch. 34: Lock' }), listed('viz', { title: 'Chapter 34' }), listed('new', { title: '  The Island  ' }), listed('bare'),
  ]);
  assert.deepEqual(c.map((x) => [x.sourceId, x.title]), [[null, 'Ch. 34: Lock'], ['viz', 'Chapter 34'], ['bare', null], ['new', 'The Island']]);
  // No listed title for the file: the chapter name it carries.
  assert.equal(copiesOf(b, [], ctx, [])[0].title, 'From the file');
});

test('a version opens in a new tab on a middle click, and the thumbnail URL follows the copy (2026-11-18)', () => {
  const src = readFileSync(join(__dirname, '..', 'app/series/page.tsx'), 'utf8');
  assert.match(src, /onAuxClick=\{\(e\) => \{ if \(e\.button === 1 && !fetching\) \{ e\.preventDefault\(\); onReadNewTab\(c\); \} \}\}/);
  assert.match(src, /img\.bookThumb\(book\.id, thumbKey\)/);
  assert.match(src, /thumbKey=\{`\$\{b\.sourceId \?\? ''\}~\$\{all\.find\(\(c\) => c\.reading\)\?\.sourceId \?\? ''\}`\}/);
  assert.doesNotMatch(src, /data-endorse-main/, 'the Endorse main source key is gone');
});
