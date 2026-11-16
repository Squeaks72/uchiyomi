import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO_DEFAULT, heroQuery, heroRows, heroSetting, moveHero, setHeroOn } from '../lib/heroBanner';

test('an account with no choice, or garbage, gets the default banner', () => {
  assert.deepEqual(heroSetting(undefined), HERO_DEFAULT);
  assert.deepEqual(heroSetting({ sources: ['nope'], count: 'x', seconds: null }), HERO_DEFAULT);
});

test('unknown kinds drop, repeats collapse, count and speed are held in range', () => {
  const s = heroSetting({ sources: ['picks', 'bogus', 'picks', 'new'], count: 99, seconds: 1 });
  assert.deepEqual(s.sources, ['picks', 'new']);
  assert.equal(s.count, 12);
  assert.equal(s.seconds, 3);
});

test('moving and switching kinds: the last one stays on, an off kind does not move', () => {
  let s = heroSetting({ sources: ['new', 'picks'] });
  s = moveHero(s, 'picks', -1);
  assert.deepEqual(s.sources, ['picks', 'new']);
  assert.equal(moveHero(s, 'picks', -1), s);
  assert.equal(moveHero(s, 'recent', 1), s);
  s = setHeroOn(s, 'recent', true);
  assert.deepEqual(s.sources, ['picks', 'new', 'recent']);
  s = setHeroOn(setHeroOn(s, 'new', false), 'recent', false);
  assert.deepEqual(s.sources, ['picks']);
  assert.equal(setHeroOn(s, 'picks', false), s, 'a banner cannot be left with nothing to show');
});

test('the rows list every kind, those on first and in order; the query carries the choice', () => {
  const s = heroSetting({ sources: ['recent', 'new'], count: 5 });
  assert.deepEqual(heroRows(s).map((r) => `${r.key}:${r.on}`), ['recent:true', 'new:true', 'continue:false', 'picks:false']);
  assert.equal(heroQuery(s), 'sources=recent,new&count=5');
});
