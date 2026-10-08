// The phone's More sheet and the keyboard chords: who is offered what.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moreEntries, moreMatch } from '../lib/moreMenu';
import { chords, shortcutKeyOk } from '../lib/shortcuts';

test('More lists the pages the tabs cannot reach; Admin and Downloads follow the account', () => {
  const keys = (o: { admin: boolean; mayDownload: boolean }) => moreEntries(o).map((e) => e.key);
  assert.deepEqual(keys({ admin: false, mayDownload: false }), ['lists', 'favorites', 'updates', 'moments', 'history', 'wrapped', 'profile']);
  assert.ok(keys({ admin: true, mayDownload: true }).includes('admin'));
  assert.ok(keys({ admin: false, mayDownload: true }).includes('downloads'));
  assert.equal(moreEntries({ admin: false, mayDownload: false }).find((e) => e.key === 'favorites')?.href, '/collection/?id=favorites');
  assert.ok(moreMatch('/collections/') && moreMatch('/profile/') && !moreMatch('/library/'));
});

test('chords: Discover and Downloads need canDownload, Admin needs admin, the device copies are gone on desktop', () => {
  const k = (c: Parameters<typeof chords>[0]) => chords(c).map((x) => x.key).join('');
  assert.ok(!k({ admin: false, mayDownload: false, desktop: false }).match(/[dvoa]/));
  assert.ok(k({ admin: true, mayDownload: true, desktop: false }).includes('a'));
  assert.ok(!k({ admin: false, mayDownload: true, desktop: true }).includes('o'));
  assert.equal(new Set(chords({ admin: true, mayDownload: true, desktop: false }).map((c) => c.key)).size, chords({ admin: true, mayDownload: true, desktop: false }).length, 'two chords share a key');
});

test('shortcuts stand down while typing, under a dialog, and with a modifier', () => {
  const e = { ctrlKey: false, metaKey: false, altKey: false };
  assert.equal(shortcutKeyOk(e, { typing: false, modalOpen: false }), true);
  assert.equal(shortcutKeyOk(e, { typing: true, modalOpen: false }), false);
  assert.equal(shortcutKeyOk(e, { typing: false, modalOpen: true }), false);
  assert.equal(shortcutKeyOk({ ...e, ctrlKey: true }, { typing: false, modalOpen: false }), false);
});
