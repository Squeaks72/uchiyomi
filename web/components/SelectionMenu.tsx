'use client';
import { useEffect, useRef, useState } from 'react';

export interface MenuItem { label: string; run: () => void; danger?: boolean }


/** The selection's actions as a small menu: at the pointer for a right click, under the Actions button otherwise. */
export function SelectionMenu({ at, items, title, onClose }: { at: { x: number; y: number }; items: MenuItem[]; title: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
      el.querySelector<HTMLElement>('button')?.focus();
    }
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placed once, when it opens
  }, []);
  return (
    <div ref={ref} role="menu" aria-label={title} style={{ left: pos.x, top: pos.y }} data-lenis-prevent
      className="glass fixed z-[70] max-h-[80vh] w-56 overflow-y-auto rounded-xl border border-ink-700 p-1 shadow-xl">
      <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fog-500">{title}</p>
      {items.map((it) => (
        <button key={it.label} role="menuitem" type="button" onClick={() => { onClose(); it.run(); }}
          className={`block w-full rounded-lg px-2.5 py-2 text-start text-sm hover:bg-ink-800/60 ${it.danger ? 'text-rose-300' : 'text-fog-100'}`}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
