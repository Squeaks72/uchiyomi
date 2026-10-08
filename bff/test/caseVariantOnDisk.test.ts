// A series stored as `Manga/X` whose folder is really `manga/X` on disk must not be re-pointed DB-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { caseVariantOnDisk } from '../src/lib/caseVariant';

test('finds the on-disk spelling of a folder stored with another case, and nothing otherwise', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-'));
  try {
    mkdirSync(join(root, 'manga', 'One Piece'), { recursive: true });
    assert.equal(await caseVariantOnDisk([root], 'Manga/One Piece'), 'manga/One Piece');
    assert.equal(await caseVariantOnDisk([root], 'manga/one piece'), 'manga/One Piece');
    assert.equal(await caseVariantOnDisk([root], 'manga/One Piece'), null, 'the exact spelling is not a variant');
    assert.equal(await caseVariantOnDisk([root], 'Manga/Other'), null, 'nothing on disk under any case');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
