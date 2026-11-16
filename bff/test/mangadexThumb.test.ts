import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

const { mangadexThumb } = require('../src/routes/images') as typeof import('../src/routes/images');

const U = 'https://uploads.mangadex.org/covers/801513ba-a712-498c-8f57-cae55b38cc92/81e1c82d-6672-400c-8c58-4ff9bfb89031.jpg';

test('a card-sized MangaDex cover asks for the 512 px copy', () => {
  assert.equal(mangadexThumb(U, 400), `${U}.512.jpg`);
  assert.equal(mangadexThumb(U, 512), `${U}.512.jpg`);
});

test('a larger request, another host, or a copy that is already a size, is left alone', () => {
  assert.equal(mangadexThumb(U, 800), null);
  assert.equal(mangadexThumb(`${U}.256.jpg`, 400), null);
  assert.equal(mangadexThumb('https://example.com/covers/801513ba-a712-498c-8f57-cae55b38cc92/81e1c82d-6672-400c-8c58-4ff9bfb89031.jpg', 400), null);
  assert.equal(mangadexThumb('http://uploads.mangadex.org/covers/801513ba-a712-498c-8f57-cae55b38cc92/81e1c82d-6672-400c-8c58-4ff9bfb89031.jpg', 400), null);
});
