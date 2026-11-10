// The phone's More sheet and the keyboard chords: who is offered what.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moreEntries, moreMatch } from '../lib/moreMenu';

test('More lists the pages the tabs cannot reach; Admin and Downloads follow the account', () => {
  const keys = (o: { admin: boolean; mayDownload: boolean }) => moreEntries(o).map((e) => e.key);
  assert.deepEqual(keys({ admin: false, mayDownload: false }), ['lists', 'favorites', 'updates', 'moments', 'history', 'wrapped', 'profile']);
  assert.ok(keys({ admin: true, mayDownload: true }).includes('admin'));
  assert.ok(keys({ admin: false, mayDownload: true }).includes('downloads'));
  assert.equal(moreEntries({ admin: false, mayDownload: false }).find((e) => e.key === 'favorites')?.href, '/collection/?id=favorites');
  assert.ok(moreMatch('/collections/') && moreMatch('/profile/') && !moreMatch('/library/'));
});

