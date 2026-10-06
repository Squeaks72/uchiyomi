// Built-in signs that a source or a title is 18+, for the viewer who is hiding 18+.
//
// A search listing names few genres, and Suwayomi flags whole extensions (so the flag cannot condemn a title: lib/searchAll.ts
// ratingOf). That left an explicit site the admin had not got round to rating 18 -- "MyAdultComics", "Doujin.io - J18" -- free
// to show every title in a search. These are the plain cases an admin would name anyway, held in code so they need no setup.
// The admin still has the last word: a source rated below 18 is never judged by its name (ratingOf `cleared`).

/** A source whose own name says it is adult. Digits are matched as a whole number, so "Manhwa18" counts and "Comic 180" does not. */
const ADULT_SOURCE_NAME = /hentai|porn|doujin|xxx|erotic|smut|nsfw|lust|adult|kingcomix|schale|(?:^|[^0-9])18(?:[^0-9]|$)/i;
export const adultSourceName = (name: unknown): boolean => typeof name === 'string' && ADULT_SOURCE_NAME.test(name);

/** Genres no mainstream title carries: explicit acts and the words sites use for adult work. Folded (trimmed, lowercase). */
const EXPLICIT_GENRES = new Set([
  'hentai', 'adult', 'smut', 'porn', 'pornographic', 'erotica', 'erotic', 'xxx', 'nsfw', 'r-18', 'r18', '18+', 'sexual content',
  'blowjob', 'handjob', 'titjob', 'footjob', 'creampie', 'cunnilingus', 'fellatio', 'anal', 'aggressive sex', 'defloration',
  'gangbang', 'bukkake', 'futanari', 'incest', 'rape', 'netorare', 'ntr', 'bdsm', 'bondage', 'urination', 'masturbation',
  'threesome', 'orgy', 'milf', 'paizuri', 'tentacles', 'lactation', 'prostitution',
]);
export const explicitGenre = (genre: unknown): boolean => typeof genre === 'string' && EXPLICIT_GENRES.has(genre.trim().toLowerCase());

/** A title that names the act outright. Whole words only, so "Cumberland" and "Analysis" are left alone. */
const EXPLICIT_TITLE = /(?<![\p{L}\p{N}])(?:fuck(?:ing|ed|s)?|cum|cumming|slut(?:s|ty)?|whore|cock|pussy|porn|hentai|creampie|blowjob|orgy|r-?18|nsfw|18\+)(?![\p{L}\p{N}])/iu;
export const explicitTitle = (title: unknown): boolean => typeof title === 'string' && EXPLICIT_TITLE.test(title);
