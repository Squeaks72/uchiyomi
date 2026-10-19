#!/usr/bin/env node
// Stop carrying a feature once its upstream PR is decided.
//
// The fork's rule: a feature goes to upstream as a PR, and from the moment that PR is closed -- merged, rebuilt by the
// maintainer in their own way, or declined -- the fork stops carrying its own copy of it. Merged or rebuilt, upstream has
// the feature now (in its form); declined, upstream has said no and the fork does not keep arguing the point in code.
// Either way what the fork runs is upstream's decision. A PR that is still OPEN stays in.
//
// .github/fork-prs.json lists the PRs whose code `tim` carries, each with the commit range the PR branch was built from
// (`base`..`head`). When one is no longer open this reverse-applies exactly that range, as its own commit, BEFORE the
// rebase onto upstream -- while `tim` still holds the PR's lines as written, so the reversal is exact and upstream's own
// version of the feature (which may now be in the same place) is never touched.
//
// It stops, changing nothing, when a range will not reverse cleanly (someone edited the feature inside `tim` instead of
// on its PR branch). That is the rule's one cost: change a carried PR's feature on the PR branch, then update `head` here.
//
//   node .github/scripts/fork-retire.mjs            retire what is decided (needs GH_TOKEN; exits 1 if any cannot be)
//   node .github/scripts/fork-retire.mjs --check    only report
// FORK_RETIRE_STATES="263=CLOSED,229=MERGED" stands in for GitHub (for trying it out).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MANIFEST = '.github/fork-prs.json';
const check = process.argv.includes('--check');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const tryGit = (...a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const upstream = manifest.upstream;
const overrides = Object.fromEntries((process.env.FORK_RETIRE_STATES || '').split(',').filter(Boolean).map((p) => p.split('=')));

function stateOf(pr) {
  if (overrides[pr]) return overrides[pr];
  const out = execFileSync('gh', ['pr', 'view', String(pr), '-R', upstream, '--json', 'state', '--jq', '.state'], { encoding: 'utf8' });
  return out.trim();
}

const decided = [];
for (const e of manifest.prs) {
  let state;
  try { state = stateOf(e.pr); } catch (err) {
    console.log(`::warning title=Retire::could not read #${e.pr}: ${(err.message || err).toString().split('\n')[0]}`);
    continue;
  }
  if (state !== 'OPEN') decided.push({ ...e, state });
}
if (!decided.length) { console.log(`retire: ${manifest.prs.length} carried PR(s), all still open`); process.exit(0); }
console.log(`retire: decided: ${decided.map((d) => `#${d.pr} ${d.state}`).join(', ')}`);
if (check) process.exit(0);

// Newest first: a PR stacked on another (its range starts where the other ends) has to come off first.
decided.reverse();
const failed = [];
const retired = [];
for (const d of decided) {
  const have = (sha) => tryGit('cat-file', '-e', `${sha}^{commit}`).status === 0;
  if (!have(d.base) || !have(d.head)) tryGit('fetch', '--quiet', 'origin', `refs/heads/${d.branch}:refs/remotes/origin/${d.branch}`);
  if (!have(d.base) || !have(d.head)) { failed.push({ d, why: `commits ${d.base.slice(0, 10)}..${d.head.slice(0, 10)} are not in the repository (the PR branch was rewritten?)` }); continue; }
  const dir = mkdtempSync(join(tmpdir(), 'retire-'));
  const changed = git('diff', '--name-status', d.base, d.head).split('\n').filter(Boolean).map((l) => l.split('\t'));
  const isLocale = (f) => /^web\/public\/locales\/[^/]+\.json$/.test(f);
  const isDoc = (f) => f.startsWith('docs/') || f === 'CHANGELOG.md';
  const exists = (f) => tryGit('cat-file', '-e', `:${f}`).status === 0;
  // Code: what the PR changed (or added) and the tree still has. A file the PR added that is already gone has nothing to undo.
  const code = changed.filter(([st, f]) => !isLocale(f) && !isDoc(f) && st !== 'D' && exists(f)).map(([, f]) => f);
  const docs = changed.filter(([st, f]) => isDoc(f) && st !== 'D' && exists(f)).map(([, f]) => f);
  const applyPaths = (paths, name) => {
    if (!paths.length) return { status: 0, stderr: '' };
    const patch = join(dir, `${d.pr}-${name}.diff`);
    writeFileSync(patch, execFileSync('git', ['diff', '--binary', d.base, d.head, '--', ...paths], { maxBuffer: 1 << 29 }));
    // --3way lets git use the blobs the PR's own diff names, so a line that moved a little still reverses; what it cannot place it leaves as a conflict.
    return tryGit('apply', '-R', '--3way', '--index', patch);
  };
  const r = applyPaths(code, 'code');
  if (r.status !== 0) {
    const conflicted = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    tryGit('reset', '--hard', 'HEAD');
    failed.push({ d, why: `would not reverse cleanly${conflicted.length ? ` (${conflicted.join(', ')})` : ''}: ${(r.stderr || '').split('\n').filter(Boolean).slice(0, 3).join(' | ')}` });
    continue;
  }
  // Documentation is best effort: a paragraph that was edited since is left for a person, and never holds the rest back.
  if (docs.length && applyPaths(docs, 'docs').status !== 0) {
    tryGit('reset', '--hard', 'HEAD');
    // the code part is still wanted: re-apply it, as the reset dropped it
    applyPaths(code, 'code');
    console.log(`::warning title=Retire #${d.pr}::the documentation for "${d.title}" was edited since and is left as it is: ${docs.join(', ')}`);
  }
  // Translations: remove the strings the PR added, key by key. Text-patching them conflicts every time two PRs append to the same file.
  for (const [, f] of changed.filter(([st, f]) => isLocale(f) && st !== 'D' && exists(f))) {
    const before = Object.keys(JSON.parse(git('show', `${d.base}:${f}`) || '{}'));
    const added = Object.keys(JSON.parse(git('show', `${d.head}:${f}`))).filter((k) => k !== '_meta' && !before.includes(k));
    const cur = JSON.parse(readFileSync(f, 'utf8'));
    for (const k of added) delete cur[k];
    if (cur._meta && typeof cur._meta.strings === 'number') cur._meta.strings = Object.keys(cur).filter((k) => k !== '_meta').length;
    writeFileSync(f, JSON.stringify(cur, null, 2) + '\n');
    git('add', f);
  }
  manifest.prs = manifest.prs.filter((p) => p.pr !== d.pr);
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  git('add', MANIFEST);
  const msg = `Stop carrying #${d.pr} (${d.state.toLowerCase()} upstream): ${d.title}\n\nThe upstream PR is decided, so the fork no longer carries its own copy of this feature: the change set ${d.base.slice(0, 10)}..${d.head.slice(0, 10)} (branch ${d.branch}) is reversed. What upstream has is what the fork runs.`;
  git('-c', 'user.name=Squeaks72', '-c', 'user.email=Squeaks72@users.noreply.github.com', 'commit', '--quiet', '-m', msg);
  retired.push(d);
  console.log(`::notice title=Retired #${d.pr}::${d.title} (${d.state.toLowerCase()} upstream)`);
}

if (process.env.GITHUB_OUTPUT && retired.length) appendFileSync(process.env.GITHUB_OUTPUT, `retired=${retired.map((d) => d.pr).join(',')}\n`);
if (failed.length) {
  // Nothing from this run is pushed: the rebase step does not run after a failure, so the fork keeps serving the last good image.
  for (const f of failed) console.log(`::error title=Cannot retire #${f.d.pr}::${f.d.title} -- ${f.why}. Reverse it by hand on tim (the range is ${f.d.base.slice(0, 10)}..${f.d.head.slice(0, 10)}), drop its entry from .github/fork-prs.json, and re-run the sync.`);
  process.exit(1);
}
