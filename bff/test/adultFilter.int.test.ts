// What the 18+ switch hides besides 18+ libraries: admin-named sources (and, in Discover, genres).
//
// adultLibrary.int.test.ts is the sweep that proves the switch reaches every listing; this file proves the
// lists behind Admin → Settings → 18+ filter feed that same switch, and nothing more:
//   - a series already IN the library is judged by its library's rating alone: a genre on
//     `server_settings.adult_genres`, or a rating on the series itself, takes nothing off a library listing.
//     Genres only judge Discover results, which have no library to be judged by;
//   - a source on `adult_sources` leaves the source list and the cross-source fan-out exactly as a
//     self-declared NSFW source does, and is not asked at all;
//   - the genre list is read in SQL from its column (browsable() cannot bind), so a hostile value stored
//     straight into the column, past the PATCH route, must neither break a listing nor change its answer,
//     and a legitimate name with an apostrophe must still match.
//
// Skipped automatically unless TEST_DATABASE_URL is set.
import test from 'node:test';
import assert from 'node:assert/strict';

const DSN = process.env.TEST_DATABASE_URL;
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || '/tmp/uchiyomi-test-config';
  process.env.LIBRARY_BACKEND = 'owned';
}
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';

const LIB = 'lib_af_clean';
const LIB18 = 'lib_af_adult';
const TAGGED = 's_af_tagged';
const EXEMPT = 's_af_exempt';
const RETAGGED = 's_af_retagged';
const QUOTED = 's_af_quoted';
const PLAIN = 's_af_plain';
const SERIES = [TAGGED, EXEMPT, RETAGGED, QUOTED, PLAIN];
const TITLE = (id: string) => `Zzz AF ${id}`;
const ADMIN = 'af-admin';
const MEMBER = 'af-member';
const CAPPED = 'af-capped';
const NAMED_SRC = 'af-src-named';
const CLEAN_SRC = 'af-src-clean';
/** A site whose search results name genres (v0.55.4): one carries a genre on the list, spelt as another site spells it. */
const GENRE_SRC = 'af-src-genre';

const asked: Record<string, number> = { [NAMED_SRC]: 0, [CLEAN_SRC]: 0 };
function fakeSource(id: string, name: string) {
  return {
    id, name,
    async search(term: string) { asked[id]++; return [{ sourceId: `${id}-1`, source: id, title: `${term} ${id}` }]; },
    async getSeries(sid: string) { return { sourceId: sid, source: id, title: name }; },
    async listChapters() { return []; },
    async getPageUrls() { return []; },
    async latest() { return []; },
    async popular() { return []; },
  };
}

test('the 18+ filter hides named genres and sources, and nothing else', { skip }, async (t) => {
  const { migrate } = await import('../src/lib/migrate');
  const { q } = await import('../src/lib/db');
  const { invalidateAdultFilter } = await import('../src/lib/visibility');
  const Fastify = (await import('fastify')).default;
  const jwt = (await import('@fastify/jwt')).default;
  const { registerAdapter } = await import('../src/lib/sources');
  await migrate();
  registerAdapter(fakeSource(NAMED_SRC, 'Zzz Named Source') as any);
  registerAdapter(fakeSource(CLEAN_SRC, 'Zzz Clean Source') as any);
  registerAdapter({
    ...fakeSource(GENRE_SRC, 'Zzz Genre Source'),
    async search(term: string) {
      return [
        { sourceId: `${GENRE_SRC}-1`, source: GENRE_SRC, title: `${term} tagged`, genres: ['Action', 'zzzaf ECCHI  '] },
        { sourceId: `${GENRE_SRC}-2`, source: GENRE_SRC, title: `${term} clean`, genres: ['Action'] },
      ];
    },
  } as any);

  const cleanup = async () => {
    await q('DELETE FROM series_overrides WHERE series_id = ANY($1)', [SERIES]).catch(() => {});
    await q('DELETE FROM lib_series WHERE id = ANY($1)', [SERIES]).catch(() => {});
    await q('DELETE FROM libraries WHERE id = ANY($1)', [[LIB, LIB18]]).catch(() => {});
    await q('DELETE FROM users WHERE username = ANY($1)', [[ADMIN, MEMBER, CAPPED]]).catch(() => {});
    // Shared database: leaving a list behind would quietly change what every later suite's listings return.
    await q(`UPDATE server_settings SET adult_genres = '[]'::jsonb, adult_sources = '[]'::jsonb WHERE id = 1`).catch(() => {});
    invalidateAdultFilter();
  };
  await cleanup();

  await q(`INSERT INTO libraries (id, name, path, age_rating) VALUES ($1,'AF Clean Shelf','/af-clean',NULL)`, [LIB]);
  await q(`INSERT INTO libraries (id, name, path, age_rating) VALUES ($1,'AF Adult Shelf','/af-adult',18)`, [LIB18]);
  // Every series starts on an UNRATED library, so nothing here can be hidden by the library rule; the genre
  // list under test must therefore leave every one of them listed. Mixed case and a stray space on
  // purpose: the filter folds case and trims in SQL, on both sides, and must still match what the scanner wrote.
  const genresOf: Record<string, string[]> = {
    [TAGGED]: ['Action', 'ZzzAF Ecchi '],
    [EXEMPT]: ['ZzzAF Ecchi'],
    [RETAGGED]: ['ZzzAF Ecchi'],
    [QUOTED]: ["ZzzAF Boys' Love"],
    [PLAIN]: ['Action'],
  };
  for (const sid of SERIES) {
    await q(
      `INSERT INTO lib_series (id, source, title, folder, books_count, library_id, genres, latest_mtime, created_at)
       VALUES ($1,'T!af',$2,$3,1,$4,$5, 1, now())`,
      [sid, TITLE(sid), `T!af/${sid}`, LIB, genresOf[sid]],
    );
  }
  // The admin re-tagged this one without the adult genre; the override is what counts.
  await q(`INSERT INTO series_overrides (series_id, genres) VALUES ($1, ARRAY['Action'])`, [RETAGGED]);

  const admin = (await q<{ id: string }>(
    `INSERT INTO users (username, display_name, password_hash, role, auth_kind) VALUES ($1,$1,'x','admin','password') RETURNING id`,
    [ADMIN],
  ))[0].id;
  const mkUser = async (name: string, cap: number | null) => (await q<{ id: string }>(
    `INSERT INTO users (username, display_name, password_hash, role, auth_kind, max_age_rating)
     VALUES ($1,$1,'x','user','password',$2) RETURNING id`, [name, cap],
  ))[0].id;
  const member = await mkUser(MEMBER, null);
  const capped = await mkUser(CAPPED, 16);
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  await app.register((await import('../src/routes/catalog')).default);
  await app.register((await import('../src/routes/sources')).default);
  await app.register((await import('../src/routes/admin')).default);
  await app.ready();
  const headers = { authorization: `Bearer ${app.jwt.sign({ sub: admin, role: 'admin' })}` };

  /** Which of this file's series the library grid lists. */
  const listed = async (adult = false): Promise<string[]> => {
    const r = await app.inject({ method: 'POST', url: `/api/series/search${adult ? '?adult=1' : ''}`, headers,
      payload: { query: 'Zzz AF', size: 100 } });
    assert.equal(r.statusCode, 200, `the listing failed: ${r.body}`);
    return SERIES.filter((sid) => r.body.includes(sid)).sort();
  };
  const patch = async (body: Record<string, unknown>) => {
    const r = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers, payload: body });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };

  try {
    await t.test('PREMISE: with empty lists nothing of ours is hidden', async () => {
      assert.deepEqual(await listed(), [...SERIES].sort());
    });

    /** What `/api/adult-filter` tells this account. */
    const offered = async (id: string, role = 'user') => {
      const r = await app.inject({ method: 'GET', url: '/api/adult-filter',
        headers: { authorization: `Bearer ${app.jwt.sign({ sub: id, role })}` } });
      assert.equal(r.statusCode, 200, r.body);
      // Only the flag crosses the wire: the lists are admin settings.
      assert.deepEqual(Object.keys(r.json()), ['configured']);
      return r.json().configured as boolean;
    };

    await t.test('/api/adult-filter says whether a reveal would change anything, and nothing more', async () => {
      // Library and Home render "Show 18+" from this when no 18+ library exists. Reintroduce by answering
      // from the library list alone: the second assertion fails, and a genre-only filter has no off switch.
      assert.equal(await offered(member), false, 'empty lists still offered a reveal');
      await patch({ adultGenres: ['zzzaf only'] });
      assert.equal(await offered(member), true, 'a configured genre did not offer the reveal to a member');
      assert.equal(await offered(admin, 'admin'), true);
      assert.equal(await offered(capped), false, 'an account capped below 18 was offered the reveal');
      await patch({ adultGenres: [], adultSources: [NAMED_SRC] });
      assert.equal(await offered(member), true, 'a configured source did not offer the reveal');
      await patch({ adultSources: [] });
      assert.equal(await offered(member), false, 'emptying the lists did not withdraw it');
    });

    await t.test('a named genre does NOT take a library series off the listing', async () => {
      const row = await patch({ adultGenres: ['  ZZZAF Ecchi', "zzzaf boys' love"] });
      assert.deepEqual(row.adult_genres, ['ZZZAF Ecchi', "zzzaf boys' love"], 'stored as typed, trimmed; case is folded where it is matched');
      // A series in the library is judged by its library alone. Reintroduce the genre clause in browsable():
      // TAGGED, EXEMPT and QUOTED vanish from the library while Show 18+ is off (Dandadan, 2026-10-22).
      assert.deepEqual(await listed(), [...SERIES].sort(), 'a genre hid a series that is filed in an unrated library');
      assert.deepEqual(await listed(true), [...SERIES].sort());
    });

    await t.test("a series' own 18+ rating does NOT take it off a library listing either", async () => {
      await q(`INSERT INTO series_overrides (series_id, age_rating) VALUES ($1, 18)
               ON CONFLICT (series_id) DO UPDATE SET age_rating = 18`, [PLAIN]);
      await q('UPDATE lib_series SET age_rating = 18 WHERE id = $1', [TAGGED]);
      try {
        assert.deepEqual(await listed(), [...SERIES].sort(), 'a per-series rating hid a series filed in an unrated library');
      } finally {
        await q('UPDATE series_overrides SET age_rating = NULL WHERE series_id = $1', [PLAIN]);
        await q('UPDATE lib_series SET age_rating = NULL WHERE id = $1', [TAGGED]);
      }
    });

    await t.test('a series in an 18+ library is hidden by the library, whatever its genres', async () => {
      await q('UPDATE lib_series SET library_id = $2 WHERE id = $1', [PLAIN, LIB18]);
      try {
        assert.ok(!(await listed()).includes(PLAIN), 'an 18+ library was listed with Show 18+ off');
        assert.ok((await listed(true)).includes(PLAIN), 'the reveal did not bring the library back');
      } finally {
        await q('UPDATE lib_series SET library_id = $2 WHERE id = $1', [PLAIN, LIB]);
      }
    });

    await t.test("the digest's context carries no lists and judges a library series by its library alone", async () => {
      const { browsableIds, SYSTEM_CTX } = await import('../src/lib/visibility');
      const allowed = await browsableIds(SERIES, { ...SYSTEM_CTX, hideAdultLibraries: true });
      assert.deepEqual([...allowed].sort(), [...SERIES].sort());
    });

    await t.test('a series the switch hides is still fillable by id', async () => {
      // "Show 18+" is a surfacing preference. A route acting on a series someone opened answers to the
      // permission, visible(), not to it: through browsable(), "Find missing chapters" was a 404 -- for an 18+
      // library already on main, and for every genre-tagged series once genres could be named.
      const r = await app.inject({ method: 'POST', url: '/api/sources/fill/scan', headers, payload: { seriesId: TAGGED } });
      assert.notEqual(r.statusCode, 404, `fill/scan refused a series its viewer opened: ${r.body}`);
    });

    await t.test('the PATCH route keeps any label and drops only what is not one', async () => {
      // Nothing configured here ever reaches a query string, so no character needs refusing for safety: a
      // curly apostrophe or a non-Latin script is a real genre, and the old whitelist was dropping both.
      // Control characters are not labels.
      const row = await patch({ adultGenres: ['ok genre', 'Boys’ Love', 'line\nbreak', "x' OR 'a'='a", 'อีโรติก'] });
      assert.deepEqual(row.adult_genres, ['ok genre', 'Boys’ Love', "x' OR 'a'='a", 'อีโรติก']);
    });

    await t.test('a hostile value stored past the route neither breaks a listing nor changes it', async () => {
      // Straight into the column, as a restored backup or a hand edit would put it. browsable() cannot
      // bind, so this is the value that would reach SQL if the sanitiser were skipped anywhere.
      const hostile = [
        "zzzaf ecchi') OR true OR lower('x", "')) OR 1=1 --", "zzzaf ecchi'; DROP TABLE lib_series; --",
        '$1', 'e\\\' OR true --', 'zzzaf ecchi',
      ];
      await q('UPDATE server_settings SET adult_genres = $1::jsonb WHERE id = 1', [JSON.stringify(hostile)]);
      invalidateAdultFilter();
      // Library listings no longer read the genre list at all, so a hostile value cannot reach them: the
      // listing answers 200 inside `listed` and shows every series.
      assert.deepEqual(await listed(), [...SERIES].sort());
      const n = await q<{ n: string }>('SELECT count(*)::text AS n FROM lib_series WHERE id = ANY($1)', [SERIES]);
      assert.equal(Number(n[0].n), SERIES.length);
    });

    await t.test('a named source leaves Discover like a self-declared adult one, and is not asked', async () => {
      await patch({ adultGenres: [], adultSources: [NAMED_SRC.toUpperCase()] });
      const ids = async (url: string) =>
        ((await app.inject({ method: 'GET', url, headers })).json().content as Array<{ id: string }>).map((s) => s.id);
      assert.ok(!(await ids('/api/sources')).includes(NAMED_SRC), 'the named source is still listed');
      assert.ok((await ids('/api/sources')).includes(CLEAN_SRC), 'the filter took the clean source too');
      assert.ok((await ids('/api/sources?adult=1')).includes(NAMED_SRC), 'the reveal did not bring it back');

      const before = { ...asked };
      const r = await app.inject({ method: 'GET', url: '/api/sources/search-all?q=Zzzafhidden', headers });
      assert.equal(r.statusCode, 200);
      assert.equal(asked[NAMED_SRC] - before[NAMED_SRC], 0, 'the fan-out still asked the named source');
      assert.equal(asked[CLEAN_SRC] - before[CLEAN_SRC], 1, 'PREMISE: the fan-out asked nobody');
    });

    await t.test('a genre is matched as the library matches it, in Discover search too (v0.55.4)', async () => {
      // Discover's 18+ filter reads the same list (lib/searchAll.ts ratingOf), folded the way browsable() folds it:
      // trimmed and case-blind on both sides. Reintroduce by matching genres as written: the tagged title stays under
      // Hide 18+ and is missing from 18+ only.
      await patch({ adultGenres: ['  ZZZAF Ecchi'], adultSources: [] });
      const search = async (qs: string) => {
        const r = await app.inject({ method: 'GET', url: `/api/sources/search-all?q=Zzzafgenre&wait=3000${qs}`, headers });
        assert.equal(r.statusCode, 200, r.body);
        return (r.json().content as Array<{ title: string; rating?: string }>)
          .filter((g) => g.title === 'Zzzafgenre tagged' || g.title === 'Zzzafgenre clean').map((g) => `${g.title}:${g.rating ?? '?'}`).sort();
      };
      assert.deepEqual(await search('&adult=1'), ['Zzzafgenre clean:safe', 'Zzzafgenre tagged:adult'], 'a genre is matched as the library matches it');
      assert.deepEqual(await search('&adult=1&rating=safe'), ['Zzzafgenre clean:safe']);
      assert.deepEqual(await search('&adult=1&rating=adult'), ['Zzzafgenre tagged:adult']);
      // With the list empty again, genres prove nothing either way.
      await patch({ adultGenres: [] });
      assert.deepEqual(await search('&adult=1'), ['Zzzafgenre clean:?', 'Zzzafgenre tagged:?']);
    });
  } finally {
    await app.close();
    await cleanup();
  }
});
