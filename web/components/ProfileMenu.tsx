'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { t as tr } from '@/lib/i18n';
import { Avatar } from './Avatar';
import { AdultToggle } from './AdultToggle';

/**
 * The avatar in the desktop header, as a popup: who you are, the way to Profile, and Show 18+.
 *
 * Show 18+ lives here on a wide screen so it is one tap from any page without a bar of its own under the
 * header; below lg the header is not rendered and AdultBar keeps the switch (see AdultToggle.tsx). Closes on
 * Escape, on a click outside, and on following a link; Escape returns focus to the avatar.
 */
export function ProfileMenu() {
  const path = usePathname();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const active = path.startsWith('/profile');

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  useEffect(() => { setOpen(false); }, [path]);

  return (
    <div ref={root} className="relative shrink-0">
      <button ref={button} type="button" aria-haspopup="true" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={tr('Profile')} onClick={() => setOpen((o) => !o)}
        className={`rounded-full transition hover:opacity-80 ${active || open ? 'ring-2 ring-accent ring-offset-2 ring-offset-ink-950' : ''}`}>
        <Avatar avatar={user?.avatar} size={40} />
      </button>
      {open && (
        <div id={menuId} role="group" aria-label={tr('Profile')} data-profile-menu
          className="absolute end-0 top-full z-50 mt-3 w-64 rounded-2xl border border-ink-700 bg-ink-900 p-3 shadow-xl">
          <div className="flex items-center gap-3 pb-3">
            <Avatar avatar={user?.avatar} size={40} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-fog-100">{user?.displayName || user?.username}</div>
              {user?.username && user.displayName && user.displayName !== user.username && (
                <div className="truncate text-xs text-fog-400">{user.username}</div>
              )}
            </div>
          </div>
          <Link href="/profile" onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-sm text-fog-100 transition hover:bg-ink-800">{tr('Profile')}</Link>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-ink-800 px-3 pt-3">
            <AdultToggle alsoWhen className="text-xs" />
          </div>
        </div>
      )}
    </div>
  );
}
