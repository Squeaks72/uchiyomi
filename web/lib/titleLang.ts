// The "Title language" setting (account setting `titleLang`, bff lib/titleLang.ts): which language edition of a work
// the Library shows a card for, and so which title is on it.

/** A language as the person reads it in that language ("Español", "日本語"); the code itself when the browser cannot say. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch { /* a code Intl does not know */ }
  return code.toUpperCase();
}

/**
 * The picker's options: the languages the server holds editions in, by name, plus the saved choice when no series is
 * in it any more (so the select never shows a language it does not list). The saved choice is the app code.
 */
export function titleLangOptions(available: readonly string[], saved: string | null): Array<{ value: string; label: string }> {
  const codes = [...new Set([...available, ...(saved ? [saved] : [])])];
  return codes.map((value) => ({ value, label: languageName(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
