'use client';
// The light novel of a series' story, on its page (above Related). AniList says which novel a manga was drawn from, or which novels
// adapt it (bff lib/anilist.ts normaliseRelated, GET /api/series/:id/novels); when BookOrbit is linked (Admin -> BookOrbit sync) and holds
// that novel as an ebook, the card opens it there -- reading, read-aloud and the rest are BookOrbit's. Drawn only when AniList names one.
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr, keys } from '@/lib/i18n';
import { Img, SectionTitle } from '@/components/ui';
import { sourceCover } from '@/components/cards';
import { statusText } from '@/lib/activity';

interface NovelAnswer {
  lookups: boolean;
  bookorbit: string | null;
  content: { anilistId: number; title: string; cover: string | null; status: string | null; score: number | null; relation: string | null;
    held: { id: number; name: string; volumes: number; path: string } | null }[];
}

const REL = ['SOURCE', 'ADAPTATION', 'ALTERNATIVE'] as const;
const REL_LABELS = keys('Source novel', 'Novel adaptation', 'Alternative version');

export function LightNovels({ seriesId }: { seriesId: string }) {
  const { data } = useQuery({ queryKey: ['novels', seriesId], queryFn: () => api<NovelAnswer>(`/api/series/${encodeURIComponent(seriesId)}/novels`),
    staleTime: 600_000, retry: false });
  if (!data?.content?.length) return null;
  return (
    <section className="mt-10 px-4" data-light-novels>
      <SectionTitle>{tr('Light novel')}</SectionTitle>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2">
        {data.content.map((n) => {
          const rel = (REL as readonly string[]).indexOf(n.relation ?? '');
          const href = n.held && data.bookorbit ? `${data.bookorbit}${n.held.path}` : null;
          return (
            <li key={n.anilistId} data-novel={n.anilistId} className="flex gap-3 rounded-2xl border border-ink-800/80 bg-ink-900/40 p-3">
              <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-ink-700/60">
                <Img src={sourceCover(undefined, n.cover)} alt="" fallbackSrc={n.cover || undefined} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="line-clamp-2 text-sm font-medium leading-snug text-fog-100">{n.title}</p>
                <p className="mt-0.5 text-[11px] text-fog-500">
                  {[rel >= 0 ? tr(REL_LABELS[rel]) : '', n.status ? statusText(n.status) : '', n.score ? `★ ${(n.score / 10).toFixed(1)}` : ''].filter(Boolean).join(' · ')}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="btn-key btn-key-primary text-xs" data-novel-open>
                      {tr('Open in BookOrbit')}{n.held!.volumes > 1 ? ` · ${tr('{n} volumes', { n: n.held!.volumes })}` : ''}
                    </a>
                  ) : (
                    <span className="text-[11px] text-fog-500">{data.bookorbit ? tr('Not in BookOrbit yet') : tr('BookOrbit is not linked')}</span>
                  )}
                  <a href={`https://anilist.co/manga/${n.anilistId}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-fog-400 hover:text-fog-100">AniList</a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
