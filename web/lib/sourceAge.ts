/**
 * The age rating an admin can put on a whole source (the Sources sheet's Age rating, v0.73.0, #256 from @Squeaks72), with
 * no React in it so a test can hold it.
 *
 * Two choices. **Automatic** (`default`) leaves it to the source: adult when its extension declares itself adult, else
 * open to every account. **Adult only** makes it adult whatever its extension says: accounts limited below 18 are refused it, and with
 * Show 18+ off it leaves Discover and search. Nothing rates a source BELOW its extension's flag -- the contributor's
 * "Mixed" would have opened a whole site to accounts limited below 18 -- so a flagged source is adult either way, and the
 * sheet says so. A series keeps its own rating, from its library: this is about the source.
 */
export const ADULT_ONLY = 18;
export type AgeChoice = 'default' | 'mixed' | 'adult';
export const AGE_CHOICES: readonly AgeChoice[] = ['default', 'mixed', 'adult'];

// Fork: **Mixed** is a SURFACING choice, for a source whose extension flags the whole site 18+ although most of it is not
// (MangaDex, Weeb Central, Tapas...). With Show 18+ off it is still asked, and each title is judged alone (adult genres, a
// content rating); a title nothing can judge stays out unless Settings → 18+ filter shows those. It does NOT open the source to an
// account limited below 18: the age cap still refuses the whole source, which is why upstream declined a Mixed permission.
// Offered only on a source its extension flags (`defaultAgeRating`), where there is something to relax.

/** What the sources overview says of one source (bff lib/sourcesOverview.ts): the admin's rating, and what it is held to without one. */
export interface AgeFacts { ageRating?: number | null; defaultAgeRating?: number | null; mixed?: boolean }

/** Which choice is lit. */
export const ageChoice = (s: AgeFacts): AgeChoice => ((s.ageRating ?? 0) >= ADULT_ONLY ? 'adult' : s.mixed ? 'mixed' : 'default');

/** The choices a source's sheet offers: Mixed only where its extension flags it (or it already is Mixed). */
export const ageChoicesFor = (s: AgeFacts): AgeChoice[] => AGE_CHOICES.filter((c) => c !== 'mixed' || (s.defaultAgeRating ?? 0) >= ADULT_ONLY || !!s.mixed);

/** Why the source is what it is, for the sentence under the choices: rated by the admin, flagged by its extension, or neither. */
export function ageWhy(s: AgeFacts): 'rated' | 'mixed' | 'flagged' | 'open' {
  if (ageChoice(s) === 'adult') return 'rated';
  if (ageChoice(s) === 'mixed') return 'mixed';
  return (s.defaultAgeRating ?? 0) >= ADULT_ONLY ? 'flagged' : 'open';
}

/** The body of the PUT that picks a choice. */
export const ageRequest = (c: AgeChoice): { ageRating: number | null; mixed?: boolean } =>
  c === 'adult' ? { ageRating: ADULT_ONLY } : c === 'mixed' ? { ageRating: null, mixed: true } : { ageRating: null };
