// The Home banner, the reader's way (the gear on the banner, components/HeroSettings.tsx): which kinds of slide it shows, in
// what order, how many, and how long each stays. Kept on the account as `settings.heroBanner` (through GET/PUT /api/settings,
// which keeps any key a newer client writes) so it follows the reader to another device.
//
// ⚠️ The keys are stored and sent to the server (`/api/hero?sources=`): rename one and a reader's choice is silently lost.
// Pure, so the rules are unit-tested (test/heroBanner.test.ts).
import { keys } from './i18n';

const LABELS = keys('New chapters of what you read', 'Keep reading', 'Daily picks', 'Recently added');
const HINTS = keys(
  'The next chapter of a series you read a lot, released in the last three weeks.',
  'A chapter you are part-way through.',
  'Series chosen for your taste, new each day.',
  'Series that just arrived in the library.',
);

/** Every kind of slide, in the order a reader who never opens the gear gets them. */
export const HERO_SOURCES = [
  { key: 'new', label: LABELS[0], hint: HINTS[0] },
  { key: 'continue', label: LABELS[1], hint: HINTS[1] },
  { key: 'picks', label: LABELS[2], hint: HINTS[2] },
  { key: 'recent', label: LABELS[3], hint: HINTS[3] },
] as const;

export type HeroKind = (typeof HERO_SOURCES)[number]['key'];
export const HERO_KINDS: readonly HeroKind[] = HERO_SOURCES.map((s) => s.key);

export interface HeroSetting {
  /** The kinds shown, in order. At least one. */
  sources: HeroKind[];
  /** How many slides, 2 to 12. */
  count: number;
  /** Seconds each slide stays, 3 to 20. */
  seconds: number;
}

export const HERO_DEFAULT: HeroSetting = { sources: ['new', 'continue', 'picks'], count: 7, seconds: 6.5 };

const clamp = (n: unknown, lo: number, hi: number, d: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : d;
  return Math.min(hi, Math.max(lo, v));
};

/** What the account holds, made safe: unknown kinds drop out, repeats collapse, an empty list is the default's. */
export function heroSetting(raw: unknown): HeroSetting {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.sources) ? r.sources : [];
  const sources = [...new Set(list.filter((k): k is HeroKind => (HERO_KINDS as readonly unknown[]).includes(k)))];
  return {
    sources: sources.length ? sources : [...HERO_DEFAULT.sources],
    count: Math.round(clamp(r.count, 2, 12, HERO_DEFAULT.count)),
    seconds: clamp(r.seconds, 3, 20, HERO_DEFAULT.seconds),
  };
}

/** The kinds in play, then the rest, for the sheet's rows: every kind is listed, those off at the end. */
export function heroRows(s: HeroSetting): { key: HeroKind; on: boolean }[] {
  return [...s.sources.map((key) => ({ key, on: true })), ...HERO_KINDS.filter((k) => !s.sources.includes(k)).map((key) => ({ key, on: false }))];
}

/** Move a kind one place among those on; a kind that is off does not move. */
export function moveHero(s: HeroSetting, key: HeroKind, by: -1 | 1): HeroSetting {
  const i = s.sources.indexOf(key), j = i + by;
  if (i < 0 || j < 0 || j >= s.sources.length) return s;
  const sources = [...s.sources];
  [sources[i], sources[j]] = [sources[j], sources[i]];
  return { ...s, sources };
}

/** Switch a kind on (at the end) or off. The last one cannot be switched off: a banner with nothing to show is the "off" switch's job. */
export function setHeroOn(s: HeroSetting, key: HeroKind, on: boolean): HeroSetting {
  if (on) return s.sources.includes(key) ? s : { ...s, sources: [...s.sources, key] };
  if (s.sources.length <= 1) return s;
  return { ...s, sources: s.sources.filter((k) => k !== key) };
}

/** The query for /api/hero. */
export const heroQuery = (s: HeroSetting): string => `sources=${s.sources.join(',')}&count=${s.count}`;
