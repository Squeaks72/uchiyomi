import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { applyFavorite, withFavorite } from '../lib/favoriteCache';

const s = (id: string, favorite: boolean) => ({ id, name: id, yomi: { favorite } });

test('favorite cache: flips only the named series, wherever it is nested', () => {
    const data = { pages: [{ items: [s('a', false), s('b', false)] }], home: { favorites: [s('a', false)] } };
    const out = withFavorite(data, 'a', true);
    assert.equal(out.pages[0].items[0].yomi.favorite, true);
    assert.equal(out.pages[0].items[1].yomi.favorite, false);
    assert.equal(out.home.favorites[0].yomi.favorite, true);
    assert.equal(out.pages[0].items[1], data.pages[0].items[1]);
});
test('favorite cache: returns the same object when nothing changes', () => {
    const data = [s('a', true)];
    assert.equal(withFavorite(data, 'a', true), data);
});
test('favorite cache: updates every cached list and the id list', () => {
    const qc = new QueryClient();
    qc.setQueryData(['library', 'x'], [s('a', false)]);
    qc.setQueryData(['home'], { updated: [s('a', false)] });
    qc.setQueryData(['favorite-ids'], ['z']);
    applyFavorite(qc, 'a', true);
    assert.equal((qc.getQueryData(['library', 'x']) as ReturnType<typeof s>[])[0].yomi.favorite, true);
    assert.equal((qc.getQueryData(['home']) as { updated: ReturnType<typeof s>[] }).updated[0].yomi.favorite, true);
    assert.deepEqual(qc.getQueryData(['favorite-ids']), ['z', 'a']);
    applyFavorite(qc, 'a', false);
    assert.deepEqual(qc.getQueryData(['favorite-ids']), ['z']);
});
