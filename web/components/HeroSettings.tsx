'use client';
// The gear on the Home banner: what the banner advertises, in what order, how many slides, how fast. Every change shows at once
// and is saved to the account (`settings.heroBanner`, lib/heroBanner.ts), one PUT at a time and always the newest choice, as
// Customize Home does it; a refused save puts back the last choice the server holds.
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t as tr } from '@/lib/i18n';
import { HERO_DEFAULT, HERO_SOURCES, heroRows, heroSetting, moveHero, setHeroOn, type HeroKind, type HeroSetting } from '@/lib/heroBanner';
import { setBannersOn } from '@/lib/bannerPref';
import { IcChevronLeft, IcChevronRight, IcSettings } from './icons';
import { Switch } from './Switch';
import { useToast } from './Toast';
import { Sheet } from './ui';

const BY_KEY = Object.fromEntries(HERO_SOURCES.map((s) => [s.key, s])) as Record<HeroKind, (typeof HERO_SOURCES)[number]>;
const COUNTS = [3, 5, 7, 10];
const SPEEDS = [{ s: 4, label: 'Fast' }, { s: 6.5, label: 'Normal' }, { s: 10, label: 'Slow' }];

/** The gear key over the banner, and the sheet it opens. Glass, like the banner's other keys, so it reads on any picture. */
export function HeroGear({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={tr('Customize banner')} title={tr('Customize banner')}
        data-hero-gear className={`grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-black/40 text-white backdrop-blur transition hover:bg-black/60 active:scale-95 ${className}`}>
        <IcSettings width={17} height={17} aria-hidden />
      </button>
      {open && <HeroSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function HeroSheet({ onClose }: { onClose: () => void }) {
  const { user, setSettings } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const s = heroSetting(user?.settings?.heroBanner);
  const plain = JSON.stringify(s) === JSON.stringify(HERO_DEFAULT);

  const sending = useRef<{ busy: boolean; next?: { v: HeroSetting }; good: unknown }>({ busy: false, good: user?.settings?.heroBanner ?? null });
  const save = (v: HeroSetting) => {
    const q = sending.current;
    q.next = { v };
    if (q.busy) return;
    q.busy = true;
    void (async () => {
      while (q.next) {
        const { v: want } = q.next;
        q.next = undefined;
        try {
          await api('/api/settings', { method: 'PUT', json: { heroBanner: want } });
          q.good = want;
          void qc.invalidateQueries({ queryKey: ['hero'] });
        } catch {
          q.next = undefined;
          setSettings({ heroBanner: q.good });
          toast(tr('Could not save'), 'error');
        }
      }
      q.busy = false;
    })();
  };
  const change = (v: HeroSetting) => { setSettings({ heroBanner: v }); save(v); };
  const rows = heroRows(s);

  return (
    <Sheet title={tr('Customize banner')} onClose={onClose} overBottomNav
      footer={
        <div className="flex items-center justify-between gap-3 pb-2">
          <button type="button" onClick={() => change({ ...HERO_DEFAULT, sources: [...HERO_DEFAULT.sources] })} disabled={plain} className="btn-key" data-hero-reset>{tr('Reset')}</button>
          <button type="button" onClick={onClose} className="btn-key btn-key-primary">{tr('Done')}</button>
        </div>
      }>
      <p className="pb-1 text-xs text-fog-500">{tr('Choose what the banner advertises, and in what order.')}</p>
      <ul data-hero-sources>
        {rows.map((r, i) => {
          const label = tr(BY_KEY[r.key].label);
          const onCount = s.sources.length;
          return (
            <li key={r.key} data-hero-source={r.key} className="flex items-center gap-2 border-b border-ink-800/70 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className={`text-sm transition-colors ${r.on ? 'text-fog-100' : 'text-fog-500'}`}>{label}</p>
                <p className="text-[11px] leading-snug text-fog-500">{tr(BY_KEY[r.key].hint)}</p>
              </div>
              <button type="button" onClick={() => change(moveHero(s, r.key, -1))} disabled={!r.on || i === 0} aria-label={tr('Move up')} className="btn-key w-8 px-0">
                <IcChevronLeft width={14} height={14} className="rotate-90" aria-hidden />
              </button>
              <button type="button" onClick={() => change(moveHero(s, r.key, 1))} disabled={!r.on || i >= onCount - 1} aria-label={tr('Move down')} className="btn-key w-8 px-0">
                <IcChevronRight width={14} height={14} className="rotate-90" aria-hidden />
              </button>
              <Switch on={r.on} onChange={(on) => change(setHeroOn(s, r.key, on))} label={label} disabled={r.on && onCount <= 1} />
            </li>
          );
        })}
      </ul>

      <div className="mt-4 grid gap-4">
        <div>
          <p className="text-sm text-fog-100">{tr('Slides')}</p>
          <div role="radiogroup" aria-label={tr('Slides')} className="mt-2 flex flex-wrap gap-2">
            {COUNTS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={s.count === n} onClick={() => change({ ...s, count: n })}
                className={`btn-key min-w-10 ${s.count === n ? 'btn-key-primary' : ''}`}>{n}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm text-fog-100">{tr('Speed')}</p>
          <div role="radiogroup" aria-label={tr('Speed')} className="mt-2 flex flex-wrap gap-2">
            {SPEEDS.map((o) => (
              <button key={o.s} type="button" role="radio" aria-checked={s.seconds === o.s} onClick={() => change({ ...s, seconds: o.s })}
                className={`btn-key ${s.seconds === o.s ? 'btn-key-primary' : ''}`}>{tr(o.label)}</button>
            ))}
          </div>
        </div>
        <div className="border-t border-ink-800/70 pt-3">
          <button type="button" className="btn-key" data-hero-off onClick={() => { setBannersOn(false); onClose(); }}>{tr('Turn the banner off')}</button>
          <p className="mt-1.5 text-[11px] text-fog-500">{tr('You can turn it back on in Settings → General → Big banners.')}</p>
        </div>
      </div>
    </Sheet>
  );
}
