// A series just added from Discover has no row until its first chapter has been scanned in, so "Open" right after the
// add used to find nothing and land on Library -> Downloads. This asks for the row for a while instead: the series the
// server named, the download job's own series for the folder, then an exact normalised title match (never the first
// search hit -- two series can normalise alike).
import { api } from './api';
import type { Page, Series } from './types';
import { normTitle } from './normTitle';

export async function waitForSeries(
  { seriesId, title, folder }: { seriesId?: string | null; title: string; folder: string },
  { tries = 10, gapMs = 2000 }: { tries?: number; gapMs?: number } = {},
): Promise<string | null> {
  if (seriesId) return seriesId;
  for (let i = 0; i < tries; i++) {
    try {
      const jobs = await api<{ content: { folder: string; seriesId?: string }[] }>('/api/sources/jobs');
      const j = jobs.content.find((x) => x.folder === folder);
      if (j?.seriesId) return j.seriesId;
      const p = await api<Page<Series>>('/api/series/search', { json: { fullTextSearch: title, size: 5 } });
      const hit = p.content.find((s) => normTitle(s.metadata?.title || s.name) === normTitle(title));
      if (hit) return hit.id;
    } catch { /* try again */ }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  return null;
}
