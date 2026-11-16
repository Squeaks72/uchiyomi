// Fork: the add dialog's "Add to library" picker. Upstream's private/shared picker (v0.108) replaced it once in a
// sync; this pins it so the next conflict resolution cannot drop it silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialog = readFileSync(new URL('../components/AddSeriesDialog.tsx', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../../bff/src/lib/ownedCatalog.ts', import.meta.url), 'utf8');

test('the add dialog offers the shared libraries, Automatic first, for a shared add', () => {
  assert.match(dialog, /const sharedLibraries = \(useLibraries\(\)\.data \?\? \[\]\)\.filter\(\(l\) => !l\.private\);/);
  assert.match(dialog, /contentScope\.visibility === 'shared' && sharedLibraries\.length > 1 &&/);
  assert.match(dialog, /<option value="">\{tr\('Automatic'\)\}<\/option>\s*\{sharedLibraries\.map/);
});

test('the chosen library goes in the add request only for a shared, non-edition add', () => {
  assert.match(dialog, /\.\.\.\(!edSeed && contentScope\.visibility === 'shared' && libraryId \? \{ libraryId \} : \{\}\),/);
});

test('the libraries list marks private libraries so the picker can leave them out', () => {
  assert.match(catalog, /private: !!r\.owner_user_id \}\)\);/);
});
