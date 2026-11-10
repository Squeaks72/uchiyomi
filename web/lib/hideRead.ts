// "Hide read chapters": the series page's chapter list without the chapters already finished, so a long series
// shows what is left to read rather than a wall of dimmed rows to scroll past.
//
// Per DEVICE, in localStorage, like the layout (lib/chapterView.ts) and the compact list: it is a way of looking,
// not a fact about the series. Read after mount -- the static export renders without storage -- and storage that
// throws reads as off. Part-read chapters stay: only a finished one is hidden.
const KEY = 'uchiyomi.hideReadChapters';

export function hideReadOn(): boolean {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}
export function setHideReadOn(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, 'on'); else localStorage.removeItem(KEY); } catch { /* a private window */ }
}
