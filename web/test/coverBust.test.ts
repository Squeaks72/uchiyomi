// A cover changed here is fetched again on every card, not read from the browser's day-long copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bustCover, withCoverBust } from '../lib/coverBust';
import { img } from '../lib/api';

test('a thumbnail address is left alone until its series cover changes, then carries the change time', () => {
  const before = img.seriesThumb('s_1');
  assert.equal(withCoverBust(before), before);
  bustCover('s_1');
  const after = withCoverBust(before);
  assert.match(after, /^\/img\/series\/s_1\/thumb\?v=2&cb=\d+$/);
  assert.equal(withCoverBust(img.seriesThumb('s_2')), img.seriesThumb('s_2'), 'another series is not touched');
  assert.match(withCoverBust(img.seriesThumb('s_1', 7, 800)), /&av=7&w=800&cb=\d+$/, 'the series page address keeps its art version');
});

test('only a series thumbnail is changed', () => {
  bustCover('s_1');
  for (const u of ['/img/books/s_1/thumb', '/img/sources/cover?u=x', 'https://example.com/a.jpg', '']) assert.equal(withCoverBust(u), u);
});
