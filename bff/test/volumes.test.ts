// Fork: volumes and arcs (lib/volumes). The Wikipedia volume-list reader against the shapes real pages use, the admin's
// text, the volume tags in chapter names, and the rule that decides when a volume is complete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVolumes, pickRun, runIsSane, parseWikiDate } from '../src/lib/volumes/wikiParse';
import { isComplete, parseManual, rangesText, toManual, volumeTagOf, volumesFromNames, unitSentence } from '../src/lib/volumes/units';
import { candidatePages } from '../src/lib/volumes/wiki';

// The notify modules read the server's env on load; they are imported inside their tests, after this.
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';

const gnl = (vol: string, list: string, extra = '') => `{{Graphic novel list
| VolumeNumber    = ${vol}
| OriginalRelDate = August 18, 2020<ref>{{cite web|title=Vol 12, chapter 99|url=https://example.org/1}}</ref>
${extra}| ChapterList     =
${list}
| Summary = Things happen in chapter 4000.
}}
`;

test('Numbered list: start, then one number per item, across two columns', () => {
  const page = gnl('1', `{{Numbered list|start=1
|{{nihongo|"The Journey's End"|冒険の終わり|Bōken no Owari}}
|{{nihongo|"The Priest's Lie"|僧侶の嘘|Sōryo no Uso}}
}}
| ChapterListCol2 =
{{Numbered list|start=3
|{{nihongo|"Blue-Moon Weed"|蒼月草|Sōgetsu Sō}}
}}`) + gnl('2', `{{Numbered list|start=4
|"Killing Magic"
|"New Year's Festival"
}}`);
  const [run] = parseVolumes(page);
  assert.deepEqual(run.volumes.map((v) => [v.label, v.chapters]), [['1', [1, 2, 3]], ['2', [4, 5]]]);
  assert.equal(run.volumes[0].released, '2020-08-18');
});

test('bullets that name their number: "001.", "*1.", "Chapter 012:"', () => {
  const page = gnl('01', '* 001. {{nihongo|"Here\'s Ranma"|らんまが来た}}\n* 002. "Ranma\'s Secret"')
    + gnl('02', '*3. {{nihongo|"Round 1000"|R}}\n*4. "Find the Red Keeper"')
    + gnl('3', '* Chapter 005: {{nihongo|"Herr Dr. Tenma"|ヘルDr.テンマ}}\n* Chapter 006: "Kill"');
  assert.deepEqual(parseVolumes(page)[0].volumes.map((v) => [v.label, v.chapters]), [['1', [1, 2]], ['2', [3, 4]], ['3', [5, 6]]]);
});

test('unnumbered items count on from the volume before; # lists too', () => {
  const page = gnl('1', '* "One"\n* "Two"\n* "Three"') + gnl('2', '# "Four"\n# "Five"');
  assert.deepEqual(parseVolumes(page)[0].volumes.map((v) => v.chapters), [[1, 2, 3], [4, 5]]);
});

test('an extra beside numbered chapters is not chapter n+1', () => {
  const page = gnl('11', '* Monster Chronicle\n* Chapter 087: "Double Darkness"\n* Chapter 088: "Remnants"')
    + gnl('12', '{{Numbered list|start=89\n|"A"\n|"B"\n}}\n* {{Nihongo|"Thunder Beast"|雷獣}}')
    + gnl('13', '{{Numbered list|start=91\n|"C"\n}}\n* Bonus chapter: "Omake"');
  assert.deepEqual(parseVolumes(page)[0].volumes.map((v) => v.chapters), [[87, 88], [89, 90], [91]]);
});

test('<li value> and <ol start>', () => {
  const page = gnl('1', '<ol start="10"><li>"Ten"</li>\n<li>"Eleven"</li></ol>') + gnl('2', '<li value="20">"Twenty"</li>');
  const v = parseVolumes(page)[0].volumes;
  assert.deepEqual(v[0].chapters, [10, 11]);
  assert.deepEqual(v[1].chapters, [20]);
});

test('a second series on the page is its own run, and the run the library holds is picked', () => {
  const page = gnl('1', '{{Numbered list|start=1\n|a\n|b\n|c\n}}') + gnl('2', '{{Numbered list|start=4\n|d\n|e\n|f\n}}')
    + gnl('1', '{{Numbered list|start=1\n|x\n}}') + gnl('2', '{{Numbered list|start=2\n|y\n}}');
  const runs = parseVolumes(page);
  assert.equal(runs.length, 2);
  assert.equal(pickRun(runs, new Set([1, 2, 3, 4, 5]))?.volumes.length, 2);
  assert.deepEqual(pickRun(runs, new Set([1, 2, 3, 4, 5]))?.volumes[1].chapters, [4, 5, 6]);
  // A page about another work: nothing it lists is held.
  assert.equal(pickRun(runs, new Set([500, 501, 502, 503])), null);
});

test('a list whose numbers go backwards is refused, not guessed at', () => {
  const page = gnl('1', '{{Numbered list|start=1\n|a\n|b\n}}') + gnl('2', '{{Numbered list|start=1\n|c\n|d\n}}') + gnl('3', '{{Numbered list|start=1\n|e\n}}');
  // Volume numbers go 1, 2, 3 (one run) but the chapters restart in each.
  assert.equal(runIsSane(parseVolumes(page)[0]), false);
  assert.equal(pickRun(parseVolumes(page), new Set([1, 2])), null);
});

test('volumes with no chapter list are left out; dates in the usual spellings', () => {
  assert.deepEqual(parseVolumes(gnl('1', '')), []);
  assert.equal(parseWikiDate('{{Start date|2019|9|17}}'), '2019-09-17');
  assert.equal(parseWikiDate('17 September 2019'), '2019-09-17');
  assert.equal(parseWikiDate('2019-09-17'), '2019-09-17');
  assert.equal(parseWikiDate('TBA'), null);
});

test('candidate pages: the list pages first, the article last', () => {
  const c = candidatePages('Monster (manga)');
  assert.equal(c[0], 'List of Monster (manga) chapters');
  assert.ok(c.includes('List of Monster chapters'));
  assert.equal(c.at(-1), 'Monster (manga)');
});

test("the admin's text: volumes, arcs with colons, ranges and half chapters; bad lines reported", () => {
  const r = parseManual('Volume 1: 1-7\nVol 2: 8-10, 10.5\n# a comment\nArc Romance Dawn: 1-7\nArc: Water 7: Enies Lobby: 322-325\nnonsense\nVolume 9: 10-1');
  assert.deepEqual(r.errors, [6, 7]);
  assert.deepEqual(r.units.map((u) => [u.kind, u.label, u.chapters]), [
    ['volume', '1', [1, 2, 3, 4, 5, 6, 7]],
    ['volume', '2', [8, 9, 10, 10.5]],
    ['arc', 'Romance Dawn', [1, 2, 3, 4, 5, 6, 7]],
    ['arc', 'Water 7: Enies Lobby', [322, 323, 324, 325]],
  ]);
  assert.equal(rangesText([8, 9, 10, 10.5]), '8-10, 10.5');
  assert.equal(toManual(r.units.slice(0, 1)), 'Volume 1: 1-7');
  assert.deepEqual(parseManual(toManual(r.units)).units, r.units);
});

test('volume tags in chapter names', () => {
  assert.equal(volumeTagOf('Vol.3 Ch.25'), '3');
  assert.equal(volumeTagOf('Volume 03 Chapter 25'), '3');
  assert.equal(volumeTagOf('v12 c100'), '12');
  assert.equal(volumeTagOf('Chapter 25: Revolver'), null);
  assert.equal(volumeTagOf('Involve'), null);
  const names = [1, 2, 3, 4, 5, 6].map((n) => ({ number: n, name: `Vol.${n <= 3 ? 1 : 2} Ch.${n}` })).concat([{ number: 7, name: 'Ch.7' }]);
  assert.deepEqual(volumesFromNames(names).map((u) => [u.label, u.chapters]), [['1', [1, 2, 3]], ['2', [4, 5, 6]]]);
  // A source that calls every chapter "Vol.1".
  assert.deepEqual(volumesFromNames(Array.from({ length: 40 }, (_, i) => ({ number: i + 1, name: `Vol.1 Ch.${i + 1}` }))), []);
});

test('complete means every whole chapter is held; a half chapter never holds a volume back', () => {
  const u = { kind: 'volume' as const, label: '2', chapters: [8, 9, 10, 10.5], released: null };
  assert.equal(isComplete(u, new Set([8, 9, 10])), true);
  assert.equal(isComplete(u, new Set([8, 10, 10.5])), false);
  assert.equal(isComplete({ chapters: [10.5] }, new Set([10.5])), false);
  assert.equal(unitSentence(u), 'Volume 2 (chapters 8–10)');
});

test('email targets: smtp(s) addresses only, real mailboxes, at most five, the password sealed', async () => {
  const { smtpEndpoint, validateTarget } = await import('../src/lib/notify/kinds');
  const ok = validateTarget('email', { url: 'smtps://smtp.gmail.com:465', username: 'me@gmail.com', token: 'app-pass', to: 'me@gmail.com, you@example.org' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.secret.to, ['me@gmail.com', 'you@example.org']);
    assert.equal(ok.secret.from, 'me@gmail.com');
    assert.equal(ok.config.display.includes('app-pass'), false);
  }
  assert.equal(validateTarget('email', { url: 'https://smtp.gmail.com', to: 'a@b.co', from: 'a@b.co' }).ok, false);
  assert.equal(validateTarget('email', { url: 'smtp://mail.example.org', to: 'a@b.co\nBcc: x@y.z', from: 'a@b.co' }).ok, false);
  assert.equal(validateTarget('email', { url: 'smtp://mail.example.org', to: 'Tim <a@b.co>', from: 'a@b.co' }).ok, false);
  assert.equal(validateTarget('email', { url: 'smtp://169.254.169.254', to: 'a@b.co', from: 'a@b.co' }).ok, false);
  assert.equal(validateTarget('email', { url: 'smtp://mail.example.org', to: 'a@b.co,b@b.co,c@b.co,d@b.co,e@b.co,f@b.co', from: 'a@b.co' }).ok, false);
  assert.equal(smtpEndpoint('smtp://Mail.Example.org'), 'smtp://mail.example.org:587');
  assert.equal(smtpEndpoint('smtps://mail.example.org'), 'smtps://mail.example.org:465');
});

test('an email is plain text, and a title cannot add a header', async () => {
  const { emailMessage } = await import('../src/lib/notify/kinds');
  const { emailReason } = await import('../src/lib/notify/email');
  const m = emailMessage({ event: 'volume_complete', title: 'Uchiyomi', message: 'Evil\r\nBcc: x@y.z: Volume 2 is complete', count: 1, series: [] });
  assert.equal(/[\r\n]/.test(m.subject), false);
  assert.match(m.text, /Volume 2 is complete/);
  assert.equal(emailReason({ code: 'EAUTH', responseCode: 535 }), 'unauthorized');
  assert.equal(emailReason({ code: 'ECONNREFUSED' }), 'refused');
  assert.equal(emailReason({ code: 'EENVELOPE', responseCode: 550 }), 'bad_response');
});
