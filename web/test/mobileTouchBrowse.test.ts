// Phone usability batch 3: browse-side screens. Each pin is phone-only (pointer-coarse / max-lg), desktop unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

test('the select bars scroll inside themselves on a phone instead of eating the screen', () => {
  for (const f of ['app/library/page.tsx', 'app/series/page.tsx', 'app/collection/page.tsx']) {
    assert.match(read(f), /z-40 max-h-\[45dvh\] overflow-y-auto overscroll-contain lg:max-h-none lg:overflow-visible/, `${f}: select bar is uncapped`);
  }
});

test('only the Library title and tabs stick on a phone', () => {
  const src = read('app/library/page.tsx');
  assert.match(src, /<\/header>\s*\{\/\*[^]*?\*\/\}\s*\{series && <div className="px-4 pb-3 lg:contents">/, 'toolbar and chips are back in the sticky header');
});

test('moments keys are finger-sized and delete is on the opposite corner from edit', () => {
  const src = read('app/moments/page.tsx');
  assert.match(src, /pointer-coarse:start-1\.5 pointer-coarse:end-auto pointer-coarse:top-1\.5/);
  assert.equal((src.match(/pointer-coarse:h-10 pointer-coarse:w-10/g) || []).length, 2);
});

test('the page grid skip key leaves the thumbnail on touch', () => {
  assert.match(read('components/PageGrid.tsx'), /pointer-coarse:static pointer-coarse:h-9 pointer-coarse:w-full/);
});

test('the series row has a visible actions key on touch', () => {
  assert.match(read('components/cards.tsx'), /lg:pointer-fine:grid pointer-coarse:grid pointer-coarse:size-10 pointer-coarse:opacity-100/);
});

test('history headings clear the status bar on a phone and keep the desktop offset', () => {
  const src = read('app/history/page.tsx');
  assert.match(src, /pt-\[calc\(env\(safe-area-inset-top\)\+0\.5rem\)\] lg:py-2/);
  assert.match(src, /lg:top-\[var\(--topbar-h\)\]/);
});

test('the search page palette route is a full-width key on a phone', () => {
  assert.match(read('app/search/page.tsx'), /data-search-palette className="btn-key mt-2 h-11 w-full justify-center text-sm lg:hidden"/);
});

test('the add dialog shows a small cover beside the source on a phone', () => {
  const src = read('components/AddSeriesDialog.tsx');
  assert.match(src, /w-20 shrink-0 self-start rounded-xl border border-ink-700 sm:hidden/);
  assert.match(src, /mb-3 hidden shrink-0 sm:mb-0 sm:block sm:w-40/);
});

test('the chapter list can hide finished chapters, per device', () => {
  const s = readFileSync(join(__dirname, '..', 'app/series/page.tsx'), 'utf8');
  assert.match(s, /!\(hideRead && b\.readProgress\?\.completed === true\)/, 'a finished chapter is not hidden');
  assert.match(s, /!\(hideRead && g\.read === true\)/, 'a ghost marked read is not hidden');
  assert.match(s, /setHideReadOn\(next\)/, 'the choice is not remembered on this device');
  assert.match(s, /setChapterPage\(null\); \}, \[id, asc, group, showGhosts, hideRead\]/, 'the page is not decided again when read chapters are hidden');
});

test('the chapter list opens newest first', () => {
  const s = readFileSync(join(__dirname, '..', 'app/series/page.tsx'), 'utf8');
  assert.match(s, /const \[asc, setAsc\] = useState\(false\);/, 'the chapter list opens oldest first again');
});

test('the sources sheet offers "notify only for a preferred group", and every prefs write carries it', () => {
  const s = readFileSync(join(__dirname, '..', 'components/SourcesSheet.tsx'), 'utf8');
  assert.match(s, /data-notify-only-preferred/, 'the switch is gone');
  assert.match(s, /patienceDays: admin\?\.prefs\?\.patienceDays \?\? null, \.\.\.notifyFields\(\) \}\);\n  \};/, 'Prefer/Block drop the notification settings');
  assert.match(s, /data-notify-sources/, 'the source filter is gone');
  assert.match(s, /patienceDays: n, \.\.\.notifyFields\(\) \}\)\) onClose/, 'Save drops the notification settings');
});

test('the Versions sheet can read a version and delete the server file', () => {
  const sheet = readFileSync(join(__dirname, '..', 'components/ChapterVersionsSheet.tsx'), 'utf8');
  assert.match(sheet, /data-read-version/, 'there is no Read on a version');
  assert.match(sheet, /\{onDelete && c\.onDisk && \(/, 'Delete file is not offered on the server copy only');
  const page = readFileSync(join(__dirname, '..', 'app/series/page.tsx'), 'utf8');
  assert.match(page, /setConfirming\(\{ what: 'delete', books: \[b\] \}\); \} : undefined\}/, 'the sheet\'s delete does not use the row menu\'s confirm');
  assert.match(page, /setPreviewing\(\{ source: src\.sourceId,/, 'Read on another copy does not open the source preview');
  assert.match(readFileSync(join(__dirname, '..', 'components/PreviewReader.tsx'), 'utf8'), /if \(initialNumber != null\) \{ setNumber\(initialNumber\); push\(2\); \}/, 'the preview cannot open on a chapter');
});

test('Show 18+ can be remembered per device, Discover says how many sources it hides, Keep all exists for backups', () => {
  const root = join(__dirname, '..');
  const adult = readFileSync(join(root, 'lib/adult.ts'), 'utf8');
  assert.match(adult, /\$\{keepAdultOn\(\) \? '; max-age=31536000' : ''\}/, 'the reveal is a session cookie even with the device setting on');
  assert.match(adult, /export function setKeepAdultOn/, 'the device setting is gone');
  assert.match(readFileSync(join(root, 'components/ProfileSettings.tsx'), 'utf8'), /Remember Show 18\+ on this device/, 'no Profile switch for it');
  assert.match(readFileSync(join(root, 'app/discover/page.tsx'), 'utf8'), /data-hidden-sources/, 'Discover does not say sources are hidden');
  assert.match(readFileSync(join(root, 'components/SourcesPanel.tsx'), 'utf8'), /\/api\/admin\/extensions\/backups\/keep-all/, 'Keep all is gone');
  const settings = readFileSync(join(root, 'components/AdminSettings.tsx'), 'utf8');
  assert.match(settings, /<MixedSourcesPicker \/>/, 'no bulk Mixed picker');
  assert.match(readFileSync(join(root, 'components/MixedSourcesPicker.tsx'), 'utf8'), /export function MixedSourcesPicker/, 'the picker is gone');
  assert.match(settings, /save\(\{ mixedShowUnknown: next \}\)/, 'no switch for unjudgeable titles');
});
