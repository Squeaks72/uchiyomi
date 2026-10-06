'use client';
// Admin -> Settings -> Downloads: the slow archive's knobs (#117). Its own file, mounted by AdminSettings.tsx
// after the Scanlators section, so the four sections settingsConsole.test.ts pins keep their order.
//
// These are the whole server's politeness towards every site, so they are an admin's: the server-wide pause,
// how many chapters an hour one source is asked for, the hours it may run in, and the free space it leaves
// alone. PATCH /api/admin/settings takes each (bff lib/archive.ts ARCHIVE_SETTINGS_SHAPE), and the running
// scheduler reads them again at once -- no restart.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { Disclosure, NumberRow, Row, Section, SwitchRow } from '@/components/settings';
import { IcClock, IcHourglass } from '@/components/icons';
import { t as tr } from '@/lib/i18n';
import { isDesktop } from '@/lib/desktop';
import { ARCHIVE_PACE, archivePaceHelp } from '@/lib/archive';
import { joinSentences } from '@/lib/jobs';
import { OVERVIEW_KEY, OVERVIEW_URL, isBlocked, sourceSays, type SourcesOverview } from '@/lib/sourcesPanel';
import { limitParts, type Limit } from '@/lib/contentRatings';

type Save = (body: Record<string, unknown>) => Promise<unknown>;

/** The window an admin starts from when switching "Only during set hours" on: the small hours. */
const WINDOW_DEFAULT = { from: 1, to: 7 };

export function DownloadsSection({ data, save }: { data: any; save: Save }) {
  const perHour: number = data.archive_per_hour ?? ARCHIVE_PACE.perHour;
  const from: number | null = data.archive_window_from ?? null;
  const to: number | null = data.archive_window_to ?? null;
  const windowOn = from != null && to != null;
  const freeGb: number | null = typeof data.archive_free_gb === 'number' ? data.archive_free_gb : null;
  const desktop = isDesktop();
  return (
    <Section id="downloads" title={tr('Downloads')} icon={<IcHourglass width={18} height={18} />}
      description={tr('The slow archive fetches whole series a chapter at a time, over nights or days, so a site never sees a burst. Queue a series from the add dialog, its page, or a Library selection.')}>
      {/* On is "not paused": the column is archive_paused, and the switch says what an admin wants to know. */}
      <SwitchRow label={tr('Slow archive')}
        help={desktop
          ? joinSentences(tr('Off pauses every archive; nothing queued is lost.'), tr('Runs only while Uchiyomi is running, even when it is only in the tray or menu bar. If the PC sleeps at night, a night-time window will rarely get anything done.'))
          : tr('Off pauses every archive; nothing queued is lost.')}
        on={data.archive_paused !== true} onChange={(next) => save({ archivePaused: !next })} />
      <NumberRow label={tr('Chapters an hour, per source')} min={ARCHIVE_PACE.perHourRange[0]} max={ARCHIVE_PACE.perHourRange[1]} value={perHour}
        help={archivePaceHelp(perHour)} onSave={(n) => save({ archivePerHour: n })} />
      {/* The window's two ends travel together: the server refuses one without the other. */}
      <SwitchRow label={tr('Only during set hours')}
        help={tr("Hours in the server's local time. 22 until 6 runs overnight.")}
        on={windowOn}
        onChange={(next) => save(next
          ? { archiveWindowFrom: WINDOW_DEFAULT.from, archiveWindowTo: WINDOW_DEFAULT.to }
          : { archiveWindowFrom: null, archiveWindowTo: null })} />
      {windowOn && (
        <>
          <NumberRow label={tr('From (hour, 0–23)')} min={0} max={23} value={from}
            onSave={(n) => save({ archiveWindowFrom: n, archiveWindowTo: to })} />
          <NumberRow label={tr('Until (hour, 0–23)')} min={0} max={23} value={to}
            help={from === to ? tr('The same hour at both ends means any time.') : undefined}
            onSave={(n) => save({ archiveWindowFrom: from, archiveWindowTo: n })} />
        </>
      )}
      <NumberRow label={tr('Stop when free space is below (GB)')} min={1} max={2000} value={data.archive_min_free_gb ?? 20}
        help={freeGb === null
          ? tr('Chapters you fetch yourself are not held to this.')
          : `${tr('Free now: {n} GB.', { n: freeGb.toLocaleString() })} ${tr('Chapters you fetch yourself are not held to this.')}`}
        onSave={(n) => save({ archiveMinFreeGb: n })} />
      <div className="py-3 last:pb-0">
        <Disclosure label={tr('How the slow archive works')}>
          <ul className="max-w-prose list-disc space-y-1 ps-4 text-[11px] leading-relaxed text-fog-500">
            <li>{tr('One chapter at a time per source, with a random pause between pages and a random break between chapters, now and then a long one. Several sites are archived side by side.')}</li>
            <li>{tr('It stands aside for the scheduled check, the library repair, the source check and anyone else downloading from the same site.')}</li>
            <li>{tr('A site that refuses is left alone for an hour, then three, then twelve, then a day at a time. The series stays queued.')}</li>
            <li>{tr('After a restart it carries on where it left off, and no break is cut short. It only fetches from the sources a series already follows; it never searches other sites.')}</li>
            <li>{tr('Chapters it brings in do not count as new chapters under Updates, and trigger no notifications.')}</li>
          </ul>
        </Disclosure>
      </div>
    </Section>
  );
}

/** What each environment knob does, in a few words: the key itself is the label, because that is what is typed in the compose file. */
const LIMIT_HELP: Record<string, () => string> = {
  SUWAYOMI_PAGE_CONCURRENCY: () => tr('Pages of one chapter fetched at the same time.'),
  SOURCE_LATEST_TIMEOUT_MS: () => tr('How long a source gets to answer the latest-chapters check.'),
  SOURCE_TEST_TIMEOUT_MS: () => tr('How long a source gets to answer a test.'),
  SCAN_CONCURRENCY: () => tr('Library folders scanned at the same time.'),
  BACKUP_KEEP: () => tr('Nightly backups kept before the oldest is deleted.'),
  CACHE_MAX_BYTES: () => tr('Size cap for the image cache; 0 means no cap.'),
};

/** A limit in the reader's words: seconds and gigabytes instead of milliseconds and bytes. */
function limitText(l: Limit): string {
  const { kind, n } = limitParts(l);
  if (kind === 's') return n === '1' ? tr('1 second') : tr('{n} seconds', { n });
  if (kind === 'gb') return l.value === 0 ? tr('No cap') : tr('{n} GB', { n });
  return n;
}

/**
 * Downloads & politeness (fork change): what keeps the server gentle with sites, in one place. The numbers that can only be
 * set by environment variables, shown read-only with the value this server is running on (GET /api/admin/limits, which
 * returns nothing but those numbers); and every source that is blocked right now, with the one control that lifts it.
 *
 * The blocked list is the Sources tab's own overview, so it lists a source the moment the Sources tab would, and Unblock is
 * the same POST the Sources sheet and Health use (`/api/admin/sources/:id/unblock`).
 */
export function PolitenessSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lim } = useQuery({
    queryKey: ['admin-limits'], queryFn: () => api<{ limits: Limit[]; note: string }>('/api/admin/limits'), staleTime: 60_000,
  });
  const { data: overview } = useQuery({
    queryKey: OVERVIEW_KEY, queryFn: () => api<SourcesOverview>(OVERVIEW_URL), staleTime: 30_000,
  });
  const blocked = (overview?.sources ?? []).filter(isBlocked);
  const unblock = async (id: string) => {
    try {
      await api(`/api/admin/sources/${encodeURIComponent(id)}/unblock`, { method: 'POST' });
      toast(tr('Block cleared'), 'success');
      await qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
      void qc.invalidateQueries({ queryKey: ['admin-sources'] });
    } catch {
      toast(tr('Could not clear the block'), 'error');
    }
  };
  return (
    <Section id="politeness" title={tr('Downloads & politeness')} icon={<IcClock width={18} height={18} />}
      description={tr('How hard this server leans on sites, and which sources are being left alone right now.')}>
      <div className="py-3 first:pt-1">
        <h3 className="text-sm font-semibold text-fog-100">{tr('Limits set by the server')}</h3>
        <p className="mt-0.5 max-w-prose text-[11px] leading-relaxed text-fog-500">
          {tr('These are set by environment variables, so they are shown here but cannot be changed here.')}
        </p>
      </div>
      {(lim?.limits ?? []).map((l) => (
        <Row key={l.key} label={l.key} help={LIMIT_HELP[l.key]?.()}>
          <span className="text-sm tabular-nums text-fog-200">{limitText(l)}</span>
        </Row>
      ))}
      <div className="py-3 last:pb-0" id="blocked-sources">
        <h3 className="text-sm font-semibold text-fog-100">{tr('Blocked sources')}</h3>
        <p className="mt-0.5 max-w-prose text-[11px] leading-relaxed text-fog-500">
          {tr('A source that refuses us is left alone for a while. Unblock tries it again at once.')}
        </p>
        {overview && blocked.length === 0 && (
          <p className="mt-2 text-sm text-fog-400">{tr('No sources are blocked right now.')}</p>
        )}
        <ul className="mt-2 divide-y divide-ink-800/80">
          {blocked.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-blocked-source={x.id}>
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm text-fog-100" title={x.id}>{x.name}</p>
                <p className="text-[11px] text-fog-500">{sourceSays(x).reason}</p>
              </div>
              <button type="button" className="btn-key" onClick={() => void unblock(x.id)}>{tr('Unblock')}</button>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
