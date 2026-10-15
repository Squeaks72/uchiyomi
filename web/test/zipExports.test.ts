// Download as zip is an admin's switch (Admin → Settings, off by default): nothing on the web offers it until the server says
// `enabled` on GET /api/exports (lib/exports.ts useZipExports). Reintroduce an ungated button and the matching test fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the hook reads `enabled` and is false until the server says so', () => {
  const src = read('lib/exports.ts');
  assert.match(src, /export function useZipExports\(\): boolean/);
  assert.match(src, /r\.enabled === true/);
  assert.match(src, /return data === true;/);
});

test('every place that offers a zip is behind it', () => {
  assert.match(read('app/collection/page.tsx'), /\{!editing && data && zipOn && <button type="button" data-list-zip/);
  assert.match(read('app/library/page.tsx'), /\{zipOn && \(\s*<button onClick=\{\(\) => \{ setMore\(false\); zipPicked\(\); \}\} data-zip-picked/);
  const series = read('app/series/page.tsx');
  assert.match(series, /\{zipOn && <button disabled=\{acting \|\| !pickedBookList\.some/);
  assert.match(series, /zipExports: zipOn,/);
  assert.match(read('lib/seriesActions.ts'), /\.\.\.\(some && x\.zipExports \? \[\{ id: 'zip' as const/);
  assert.match(read('components/SeriesActions.tsx'), /\.\.\.\(zipOn \? \[\{\s*label: tr\('Download as zip'\)/);
});

test('an admin can switch it on in Admin → Settings, and it is off unless the server says true', () => {
  assert.match(read('components/AdminSettings.tsx'), /<SwitchRow label=\{tr\('Download as zip'\)\}[\s\S]{0,700}on=\{data\.zip_exports === true\} onChange=\{\(next\) => save\(\{ zipExports: next \}\)\}/);
});
