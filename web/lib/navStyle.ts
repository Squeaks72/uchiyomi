// One look for the round buttons in the desktop top bar's right-hand cluster (Moments, Server fetching, Updates,
// Check for new chapters, Profile), so "you are here" reads the same on every one of them. They used to disagree:
// Moments only recoloured its icon, Updates and Profile showed nothing at all.
const BASE = 'grid h-10 w-10 shrink-0 place-items-center rounded-full border transition';
export const NAV_ICON_ACTIVE = 'border-accent/50 bg-accent-soft text-accent';
export const NAV_ICON_IDLE = 'border-ink-700 text-fog-300 hover:text-accent';

export function navIconCls(active: boolean, extra = ''): string {
  return `${BASE} ${active ? NAV_ICON_ACTIVE : NAV_ICON_IDLE}${extra ? ` ${extra}` : ''}`;
}
