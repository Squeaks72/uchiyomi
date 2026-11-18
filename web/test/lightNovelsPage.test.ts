// Light novels (components/LightNovels.tsx): the series page draws only novels BookOrbit holds; everything else is in Edit details.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const src = read('components/LightNovels.tsx');

test('the page section filters to held novels and draws nothing without one, admin or not', () => {
  const page = src.slice(src.indexOf('export function LightNovels('), src.indexOf('export function LightNovelDetails('));
  assert.match(page, /filter\(\(n\) => readable\(n, data\.bookorbit\)\)/);
  assert.match(page, /if \(!data \|\| !held\.length\) return null;/);
  assert.doesNotMatch(page, /data-novel-attach|canEdit/);
  assert.match(src, /export const readable = \(n: NovelAnswer\['content'\]\[number\], bookorbit: string \| null\) => !!\(n\.held && bookorbit\);/);
});

test('attaching and the unheld novels live in Edit details', () => {
  const details = src.slice(src.indexOf('export function LightNovelDetails('));
  assert.match(details, /data-novel-attach/);
  assert.match(read('components/SeriesEditor.tsx'), /<LightNovelDetails seriesId=\{id\} \/>/);
  assert.match(read('app/series/page.tsx'), /<LightNovels seriesId=\{id\} \/>/);
});
