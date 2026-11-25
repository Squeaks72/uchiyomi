// A blocked group's chapters still downloaded (#396, components/BlockedChapters.tsx): counted where a group is blocked,
// and removed completely only when the admin says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockedChaptersText } from '../components/BlockedChapters';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

test('the question says how many chapters, series and readers it is about', () => {
  const one = blockedChaptersText({ chapters: 1, series: 1, readers: 0 }, false);
  assert.match(one, /^1 downloaded chapter is only from blocked groups\. Remove them completely/);
  assert.doesNotMatch(one, /history/, 'nobody read it: no history to lose');
  assert.match(blockedChaptersText({ chapters: 3, series: 1, readers: 1 }, false), /^3 downloaded chapters .* for 1 reader\.$/);
  assert.match(blockedChaptersText({ chapters: 3, series: 2, readers: 4 }, true), /They are in 2 different series\..* for 4 readers\.$/);
  assert.doesNotMatch(blockedChaptersText({ chapters: 3, series: 2, readers: 0 }, false), /different series/, 'one series\' sheet names no series count');
});

test('asked under the Sources sheet\'s group rows and in the Scanlation groups editor, and a block re-counts', () => {
  const sheet = read('components/SourcesSheet.tsx');
  assert.match(sheet, /\{isAdmin && <BlockedChaptersAsk seriesId=\{id\} \/>\}\s*<\/section>/);
  assert.match(sheet, /void qc\.invalidateQueries\(\{ queryKey: blockedChaptersKey\(id\) \}\);\s*onSaved\(\);/);
  const settings = read('components/AdminSettings.tsx');
  assert.match(settings, /<div id="blocked-groups">[\s\S]*?<BlockedChaptersAsk \/>\s*<\/div>/);
  assert.match(settings, /void qc\.invalidateQueries\(\{ queryKey: \['blocked-chapters'\] \}\);/);
});

test('removing is a confirmed step with the ids that were shown, asked inline (a dialog under a Sheet cannot be tapped)', () => {
  const ask = read('components/BlockedChapters.tsx');
  // The fork's kept copies ride along: the blocked groups' copies the count listed, by bookId|sourceId.
  assert.match(ask, /'\/api\/admin\/blocked-chapters\/purge', \{\s*method: 'POST', json: \{ bookIds: data!\.books\.map\(\(b\) => b\.id\), copies: copyKeys \}/);
  assert.match(ask, /role="alertdialog"/);
  assert.doesNotMatch(ask, /<ConfirmDialog|<Modal/);
  assert.match(ask, /setKept\(asked\)/, 'Keep answers for the chapters asked about only');
});

test('fork: kept copies -- a chapter with another group\'s copy is said to switch, and blocked kept copies are counted', () => {
  const swap = blockedChaptersText({ chapters: 2, series: 1, readers: 0, endorsing: 1, copies: [] }, false);
  assert.match(swap, /^2 downloaded chapters .* 1 chapter keeps another group's copy: that copy is used instead\./);
  const onlyCopies = blockedChaptersText({ chapters: 0, series: 1, readers: 0, endorsing: 0,
    copies: [{ bookId: 'b', sourceId: 's', seriesId: 'x', number: 1, scanlator: 'Bad' }, { bookId: 'c', sourceId: 's', seriesId: 'x', number: 2, scanlator: 'Bad' }] }, false);
  assert.match(onlyCopies, /^2 kept copies come from a blocked group\. Remove them completely/);
  assert.doesNotMatch(onlyCopies, /downloaded chapter/, 'no chapter goes: none is named');
});
