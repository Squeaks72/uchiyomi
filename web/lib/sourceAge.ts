/**
 * The age rating an admin can put on a whole source (Sources sheet -> Age rating), with no React in it so a test can hold it.
 *
 * `null` is "no rating of mine": the source is held to what its extension says (18 when it declares itself adult, else
 * nothing). 0 is all ages, which also cancels an extension's adult flag. Anything else is the youngest account allowed in.
 */
export const SOURCE_AGES: readonly number[] = [0, 10, 13, 15, 17, 18];

export interface AgeFacts { ageRating?: number | null; defaultAgeRating?: number | null }

/** The rating the source is held to now, or null when it is unrated. */
export function effectiveAge(s: AgeFacts): number | null {
  if (s.ageRating !== undefined && s.ageRating !== null) return s.ageRating > 0 ? s.ageRating : null;
  return s.defaultAgeRating ?? null;
}

/** Which chip is lit: 'default' when nothing is set, else the number. */
export function ageChoice(s: AgeFacts): number | 'default' {
  return s.ageRating === undefined || s.ageRating === null ? 'default' : s.ageRating;
}

/** The body of the PUT that picks a chip. */
export function ageRequest(choice: number | 'default'): { ageRating: number | null } {
  return { ageRating: choice === 'default' ? null : choice };
}
