// A source's name with its language, without saying the language twice.
//
// Several sources carry the language in their own name already -- MangaDex (PT-BR), every extension source "Name (EN)" -- and the
// search-and-pick lists added the source's language after the name again: "MangaDex (PT-BR) (PT-BR)". The language is appended only
// when the name does not already end in a bracketed language tag.
const ENDS_IN_LANG = /\s\((?:[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,4})?|ALL)\)\s*$/i;

export function sourceWithLang(name: string, lang?: string | null): string {
  const l = (lang ?? '').trim();
  if (!l || ENDS_IN_LANG.test(name)) return name;
  return `${name} (${l.toUpperCase()})`;
}
