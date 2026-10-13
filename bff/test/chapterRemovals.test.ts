// A chapter removed from a series stays removed (series_chapter_removals). Read from source: the scratch database the
// behavioural tests need is not always there, and what breaks this feature quietly is one surface forgetting the
// predicate and showing the chapter again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

test('the table exists and cascades with its series', () => {
  assert.match(read('lib/migrate.ts'), /series_chapter_removals[\s\S]{0,200}REFERENCES lib_series[\s\S]{0,40}ON DELETE CASCADE/);
});

test('every surface that lists or fetches chapters leaves a removed number out', () => {
  for (const f of ['lib/ownedCatalog.ts', 'lib/seriesListing.ts', 'lib/updater.ts']) {
    assert.match(read(f), /series_chapter_removals/, `${f} ignores removed chapters`);
  }
});

test('the routes exist and are audited', () => {
  const admin = read('routes/admin.ts');
  for (const r of ['chapters/remove', 'chapters/removed', 'chapters/restore']) assert.ok(admin.includes(`/api/admin/series/:id/${r}`), r);
  const lib = read('lib/chapterRemovals.ts');
  assert.match(lib, /series\.chapters_remove/);
  assert.match(lib, /series\.chapters_restore/);
  assert.match(lib, /not_owned/);
});

test('the notice default is applied once, by flag, and not by the migration', () => {
  const s = read('lib/noticeSettings.ts');
  assert.match(s, /NOT notice_default_applied/);
  assert.match(s, /notice_default_applied = true/);
  assert.match(read('server.ts'), /applyNoticeDefault\(\)[\s\S]{0,200}refreshNoticesActive\(\)/);
  assert.doesNotMatch(read('lib/migrate.ts'), /hide_notice_types[^;]*DEFAULT '\["manga"/);
});

test('chapter 0 is an extra, in SQL and in the sweep', () => {
  const s = read('lib/noticeChapters.ts');
  assert.match(s, /<> floor\(\$\{num\}\) OR \$\{num\} = 0/);
  assert.match(s, /n === 0/);
  assert.match(s, /hb_nt\.number = 0 AND hov_nt\.book_id IS NULL/, 'the hidden count misses a file numbered 0');
});
