// Admin → Settings → 18+ filter, and the per-series "Always show" beside it.
//
// Read from source, like settingsConsole.test.ts. The server half (what the lists hide, the exemption, the
// sanitiser) is bff/test/adultFilter*.test.ts; this pins the three ways the page itself went wrong or could:
// a picker that hides what it configures, a double click that loses a toggle, and an edit dialog that
// clears an exemption it never showed. Every guard names the edit that makes it fail again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { metaBody, seedMeta } from '../lib/seriesMeta';
import type { Series } from '../lib/types';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const section = (): string => {
  const src = code(read('components/AdminSettings.tsx'));
  const s = src.slice(src.indexOf('function ContentRatingsSection('), src.indexOf('function SourceOrderBlock('));
  assert.ok(s.length > 0, 'no ContentRatingsSection');
  return s;
};

test('the section comes after Notifications, so the pinned order of the others is untouched', () => {
  // Reintroduce by rendering it anywhere above <NotificationsSection />: the four-section order that
  // settingsConsole.test.ts and run.mjs rely on would shift.
  const src = code(read('components/AdminSettings.tsx'));
  const grid = src.slice(src.indexOf('<div className={SETTINGS_GRID}>\n      <ServerSection'));
  assert.ok(grid.indexOf('<NotificationsSection />') > 0, 'PREMISE: no Notifications section');
  assert.ok(grid.indexOf('<ContentRatingsSection data={data} save={save} />') > grid.indexOf('<NotificationsSection />'),
    'Content ratings (the old 18+ filter) is not after Notifications');
});

test('the genre picker asks with the reveal on, and the source list is the admin overview, so neither can hide its own entry', () => {
  // With "Show 18+" off, a genre ticked here is exactly what the listings stop returning, so a picker built from them
  // loses the chip the moment it is lit and it can never be unticked. Reintroduce by asking `/api/genres/overview` as it
  // is: the match below fails. And never an unconditional `?adult=1` (lib/api.ts adds its own when the reveal is on; two
  // copies read as hidden). The per-source ratings come from the admin overview, which lists every source whatever the
  // reveal says (an admin manages them all), so they ask with no reveal rule at all and under the Sources tab's own key.
  const s = section();
  assert.match(s, /const revealed = \(path: string\) => \(adultShown\(\) \? path : `\$\{path\}\$\{path\.includes\('\?'\) \? '&' : '\?'\}adult=1`\);/,
    'the reveal-aware URL rule is gone');
  assert.match(s, /revealed\('\/api\/genres\/overview\?covers=1'\)/, 'the genre picker is built from the filtered list');
  assert.doesNotMatch(s, /\('\/api\/(?:sources|genres\/overview)[^']*adult=1'\)/, 'adult=1 is hard-coded');
  // Its own key: a revealed answer under a browsing screen's key is replayed to that screen.
  assert.match(s, /queryKey: \['genres-overview', 'all'\]/);
  assert.match(s, /queryKey: OVERVIEW_KEY, queryFn: \(\) => api<SourcesOverview>\(OVERVIEW_URL\)/, 'the ratings are not built from the admin sources overview');
  assert.doesNotMatch(s, /revealed\('\/api\/sources'\)/, 'the retired adult-sources chip list is back');
});

test('a genre toggle is saved from local state, and a failed save puts the chip back', () => {
  // Toggled against `data` directly, two quick clicks each started from the list as it was before either
  // PATCH landed, and the second quietly undid the first. Reintroduce by
  // `onClick={() => save({ adultGenres: toggle(genres, g.key) })}` over `data.adult_genres`: fails.
  const s = section();
  assert.match(s, /const \[genres, setGenres\] = useState<string\[\]>/, 'the genre list is not held locally');
  assert.match(s, /onClick=\{\(\) => flip\('adultGenres', genres, setGenres, g\.key\)\}/);
  assert.match(s, /\.catch\(\(\) => \{ set\(list\); toast\(tr\('Could not save'\), 'error'\); \}\);/,
    'a failed save leaves the chip lit over a list that was not stored');
  // Fork change: the adult_sources chip editor is retired (the server folds the list into ratings at boot), so nothing
  // here saves `adultSources` any more.
  assert.doesNotMatch(s, /adultSources/, 'the retired adult-sources list is saved from Content ratings again');
});

test('each source has one rating select, saved through the age-rating route, and rolled back when refused', () => {
  const s = section();
  assert.match(s, /api\(`\/api\/admin\/sources\/\$\{encodeURIComponent\(id\)\}\/age-rating`, \{ method: 'PUT', json: ageRequest\(choice\) \}\)/, 'the rating is not saved through the age-rating route');
  assert.match(s, /\(\['default', \.\.\.SOURCE_AGES\] as Array<number \| 'default'>\)\.map/, 'the select does not offer Default and every age of lib/sourceAge.ts');
  assert.match(s, /catch \{\s*toast\(tr\('Could not save'\), 'error'\);\s*\} finally \{\s*setPicked/, 'a refused rating is not reported and dropped');
  assert.match(s, /data-lenis-prevent data-source-ratings/, 'the scrolling list is not held for Lenis');
  assert.match(s, /tr\('\{n\} sources rated', \{ n: summary\.rated \}\)\} · \{tr\('Treated as 18\+: \{m\}'/, 'the summary line is gone');
  // The three groups, and the two links to where the permissions live.
  for (const t of ['Who may open it', 'What the Show 18+ switch hides', 'How the rules work']) assert.ok(s.includes(`title={tr('${t}')}`), `the ${t} group is gone`);
  assert.match(s, /href="\/admin\/\?tab=Members"/);
  assert.match(s, /href="\/admin\/\?tab=Library"/);
  assert.match(s, /href="\/profile\/\?tab=Connections"/, 'the OPDS / tokens note does not link to Profile → Connections');
  // Desktop has no Members tab and no OPDS or tokens.
  assert.match(s, /\{!desktop && \(\s*<Row label=\{tr\('Account age caps'\)\}/, 'the account caps row shows on desktop');
});

test('the edit dialog seeds "Always show" from the override and sends it on save', () => {
  // The route leaves the flag alone when the field is absent, so a dialog that did not know about it would
  // be harmless -- but one that sent `false` without seeding it would clear every exemption on a retitle.
  // Since v0.53.0 the dialog (components/SeriesEditor.tsx) seeds and sends through lib/seriesMeta.ts, driven here
  // with plain values. Reintroduce by seeding `adultExempt: false` there: "the switch is not seeded" fails.
  const base: Series = {
    id: 's_1', libraryId: 'lib', name: 'Kept', booksCount: 1, booksReadCount: 0, booksUnreadCount: 1, booksInProgressCount: 0,
    metadata: { title: 'Kept' },
    overrides: { title: null, summary: null, cover: null, banner: null, author: null, status: null, genres: null, ageRating: null, adultExempt: true },
  };
  assert.equal(seedMeta(base).adultExempt, true, 'the switch is not seeded from the override');
  assert.equal(seedMeta({ ...base, overrides: undefined }).adultExempt, false);
  // Every save carries it, a retitle included: the whole object goes up on each one.
  assert.equal(metaBody({ ...seedMeta(base), title: 'Renamed' }).adultExempt, true, 'the save does not send the flag');
  // And the switch is wired to that save, not to a copy of the flag of its own.
  const editor = read('components/SeriesEditor.tsx');
  assert.match(editor, /<SwitchRow label=\{tr\('Always show'\)\} on=\{meta\.adultExempt\}/, 'the switch does not show the seeded flag');
  assert.match(editor, /onChange=\{\(adultExempt\) => save\(\{ adultExempt \}\)\}/, 'flipping the switch does not save it');
});

test('every new string is in all eight locale files', () => {
  // settingsConsole.test.ts already scans AdminSettings.tsx (the list below is the section's headings); the dialog's two strings live in Edit details
  // (components/SeriesEditor.tsx since v0.53.0), which no locale test of its own reads. Reintroduce by deleting
  // "Always show" from public/locales/ar.json.
  const keys = [
    'Content ratings', 'No genres yet.', 'Always show',
    'Who may open it', 'What the Show 18+ switch hides', 'How the rules work',
    'OPDS links and API tokens each have their own Include 18+ switch.',
    'One series can be let through on its own page — Edit details ▸ “Always show”.',
    'Keep this series on the shelf while “Show 18+” is off, even if it or one of its genres is 18+.',
  ];
  for (const k of keys) {
    assert.ok(['components/AdminSettings.tsx', 'components/SeriesEditor.tsx'].some((f) => read(f).includes(`tr('${k}')`)),
      `"${k}" is no longer rendered -- update this list`);
  }
  const files = readdirSync(join(ROOT, 'public/locales')).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 8);
  for (const f of files) {
    const d = JSON.parse(read(`public/locales/${f}`));
    const missing = keys.filter((k) => !(k in d) || !String(d[k]).trim() || d[k] === k);
    assert.deepEqual(missing, [], `${f} lacks (or copies the English of) ${missing.join(' | ')}`);
  }
});

test('the 18+ reveal still renders on Library and Home when only the 18+ filter has something to hide', () => {
  // AdultToggle renders on its own only when the account holds an 18+ LIBRARY. With genres or sources on the
  // 18+ filter and no such library, those series were hidden with no off switch on either page -- the
  // failure `alsoWhen` exists for (see discoverAdult.test.ts). Reintroduce by dropping
  // `alsoWhen={adultFilter}` from either page: "has no second reason" fails for it; by reading the flag from
  // anything but `/api/adult-filter`: "the hook" fails.
  const hook = code(read('components/AdultToggle.tsx'));
  assert.match(hook, /export function useAdultFilterConfigured\(\): boolean \{[\s\S]*?queryKey: \['adult-filter'\][\s\S]*?api<\{ configured: boolean \}>\('\/api\/adult-filter'\)[\s\S]*?return data\?\.configured === true;/,
    'the hook no longer asks /api/adult-filter');
  for (const [file, tag] of [['app/page.tsx', '<AdultToggle className="shrink-0" alsoWhen={adultFilter} />'], ['app/library/page.tsx', '<AdultToggle alsoWhen={adultFilter} />']]) {
    const src = code(read(file));
    assert.ok(src.includes('const adultFilter = useAdultFilterConfigured();'), `${file} does not ask whether the filter is configured`);
    assert.ok(src.includes(tag), `${file}'s reveal has no second reason, so a genre-only filter has no off switch there`);
  }
  // A save that changes the lists must refresh the answer, or the switch appears (or goes) only after
  // five minutes.
  assert.match(section(), /qc\.invalidateQueries\(\{ queryKey: \['adult-filter'\] \}\)/, 'a save does not refresh the reveal');
});
