// Pure rules of Admin -> Library -> Unmapped files: the number a file name suggests, and the name a mapped file takes.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@localhost:1/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

test('the chapter number a file name suggests', async () => {
  const { guessChapterNumber: g } = await import('../src/lib/unmapped');
  const cases: Array<[string, number | null]> = [
    ['Chapter 12.cbz', 12], ['Chapter 84.5.cbz', 84.5], ['Ch.12.zip', 12], ['c012.cbz', 12], ['One Piece #1103.cbz', 1103],
    ['Berserk - 042 (Digital) [Group].cbz', 42], ['Berserk v03 c021 (2019).cbz', 21], ['Title Vol. 3.cbz', null],
    ['Berserk 2019.cbz', null], ['ep 7.pdf', 7], ['notes.cbz', null], ['Title 5 (2020).cbz', 5],
  ];
  for (const [name, want] of cases) assert.equal(g(name), want, name);
});

test('a mapped file is named as the downloader names a chapter', async () => {
  const { chapterFileName } = await import('../src/lib/unmapped');
  assert.equal(chapterFileName(84.5, '.CBZ'), 'Chapter 84.5.cbz');
  assert.equal(chapterFileName(3, '.pdf'), 'Chapter 3.pdf');
});
