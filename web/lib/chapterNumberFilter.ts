// The chapter-number box above a series' chapter list (2026-11-18): narrow the list to the chapters a typed number names.
//
// A whole number narrows as it is typed -- "2" keeps 2, 20-29 and 200-299; "21" keeps 21 and 210-219; "213" keeps 213 and its parts
// (213.5) -- so the list closes in on a chapter key by key. A number with a decimal point is exact ("213.5"). Anything else filters nothing.
// Pure, so the rule is unit-tested (test/chapterNumberFilter.test.ts).

/** The matcher for what is typed, or null when it is not a chapter number (empty included): then the list is unfiltered. */
export function chapterNumberMatcher(typed: string): ((n: number) => boolean) | null {
  const t = typed.trim().replace(/^(?:ch(?:apter)?\.?|#)\s*/i, '');
  if (!/^\d{1,6}(?:\.\d{0,3})?$/.test(t)) return null;
  if (t.includes('.') && !t.endsWith('.')) {
    const want = Number(t);
    return (n) => Math.abs(n - want) < 1e-6;
  }
  const whole = t.replace(/\.$/, '');
  return (n) => n >= 0 && String(Math.floor(n)).startsWith(whole);
}
