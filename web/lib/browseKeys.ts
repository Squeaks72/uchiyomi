import type { QueryClient } from '@tanstack/react-query';

/**
 * Everything on screen that LISTS series and is cached on the client for minutes: the library grid, Home's rails and the
 * recommendation rows under them (For you, Trending, Featured, Because you read), which keep their own ten-minute caches.
 * A change to what is hidden -- filing a series into an 18+ library -- has to drop all of them, or the series stays on the
 * rows nothing refetched.
 */
const BROWSE_KEYS = ['library', 'home', 'foryou', 'trending', 'featured', 'because', 'collection', 'favorite-ids'] as const;

export function invalidateBrowsing(qc: QueryClient): void {
  for (const k of BROWSE_KEYS) qc.invalidateQueries({ queryKey: [k] });
}
