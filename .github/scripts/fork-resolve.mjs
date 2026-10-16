#!/usr/bin/env node
// Resolves the conflicts of a fork sync that are mechanical, and reports the ones that are not (exit 1).
//
// Run in the middle of a `git merge --squash` / `git rebase` that stopped on conflicts. Three kinds of file, none of which
// carries a decision a person has to make:
//
//  - web/public/locales/*.json: both sides appended strings at the end of the file. The union is right: upstream's file, plus
//    every key the fork added (or changed, where upstream left that key alone), with `_meta.strings` recounted.
//  - bff/package-lock.json: upstream's file, regenerated from the merged package.json afterwards (`--lock`).
//  - CHANGELOG.md: upstream's. The fork keeps no entries of its own there.
//
// Anything else stays conflicted and is listed, so a real conflict still stops the run.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const show = (stage, f) => { try { return git('show', `:${stage}:${f}`); } catch { return null; } };

const unmerged = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
const left = [];
let lock = false;

for (const f of unmerged) {
  if (/^web\/public\/locales\/[^/]+\.json$/.test(f)) {
    const base = JSON.parse(show(1, f) ?? '{}'), ours = JSON.parse(show(2, f)), theirs = JSON.parse(show(3, f));
    const out = { ...ours };
    for (const [k, v] of Object.entries(theirs)) {
      if (k === '_meta') continue;
      if (!(k in base) && !(k in out)) out[k] = v;                  // a string the fork added
      else if (k in base && base[k] !== v && out[k] === base[k]) out[k] = v; // a string the fork changed, which upstream left alone
    }
    out._meta = { ...ours._meta, strings: Object.keys(out).length - 1 };
    writeFileSync(f, JSON.stringify(out, null, 2) + '\n');
    git('add', f);
    console.log(`resolved ${f}: ${Object.keys(out).length - 1} strings`);
  } else if (f === 'bff/package-lock.json') {
    git('checkout', '--ours', '--', f); git('add', f); lock = true;
    console.log(`resolved ${f}: upstream's, to be regenerated`);
  } else if (f === 'CHANGELOG.md') {
    git('checkout', '--ours', '--', f); git('add', f);
    console.log(`resolved ${f}: upstream's`);
  } else {
    left.push(f);
  }
}

if (process.argv.includes('--lock') || lock) {
  try {
    if (!left.includes('bff/package.json')) {
      execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: 'bff', stdio: 'inherit' });
      git('add', 'bff/package-lock.json');
    }
  } catch (e) { console.log(`could not regenerate bff/package-lock.json: ${e.message}`); }
}

if (left.length) {
  for (const f of left) console.log(`::error title=Sync conflict::${f}`);
  process.exit(1);
}
