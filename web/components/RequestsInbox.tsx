'use client';
// The admin's side of readers' requests (2026-11-18, bff routes/requests.ts), at the top of Discover while any is open: one row per title,
// who asked and their notes. "Find and add" opens Discover's source search on the title -- once the series is in the library the request
// answers itself and the readers are told. "Decline" asks for an optional note the readers see.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { relativeTime } from '@/lib/format';
import { sourceCover } from './cards';
import { Img } from './ui';
import { Modal } from './ConfirmDialog';
import { useToast } from './Toast';

interface Group { key: string; title: string; coverUrl: string | null; ids: string[]; who: string[]; notes: { who: string; note: string }[]; firstAt: string }

export function RequestsInbox() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['admin-requests'], queryFn: () => api<{ open: Group[] }>('/api/admin/requests'), staleTime: 30_000 });
  const [declining, setDeclining] = useState<Group | null>(null);
  const [note, setNote] = useState('');
  const open = data?.open ?? [];
  if (!open.length) return null;
  const decline = async () => {
    if (!declining) return;
    try {
      await api('/api/admin/requests/answer', { method: 'POST', json: { ids: declining.ids, status: 'declined', note: note.trim() || null } });
      toast(tr('Declined'), 'success');
      setDeclining(null); setNote('');
      void qc.invalidateQueries({ queryKey: ['admin-requests'] });
    } catch { toast(tr('Could not save'), 'error'); }
  };
  return (
    <section className="mb-6 mt-4 rounded-2xl border border-accent/30 bg-accent/[0.04] p-4" data-requests-inbox>
      <p className="text-sm font-semibold text-fog-100">{open.length === 1 ? tr('1 series requested') : tr('{n} series requested', { n: open.length })}</p>
      <ul className="mt-2 divide-y divide-ink-800/70">
        {open.map((g) => (
          <li key={g.key} className="flex items-center gap-3 py-2.5" data-request={g.key}>
            <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-ink-800 bg-ink-900">
              {g.coverUrl && <Img src={sourceCover(undefined, g.coverUrl)} alt="" className="h-full w-full" />}
            </div>
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate text-sm text-fog-100">{g.title}{g.who.length > 1 && <span className="text-fog-500"> · ×{g.who.length}</span>}</p>
              <p className="truncate text-[11px] text-fog-500">{g.who.join(', ')} · {relativeTime(g.firstAt)}</p>
              {g.notes.map((n, i) => <p key={i} dir="auto" className="truncate text-[11px] text-fog-400">“{n.note}” — {n.who}</p>)}
            </div>
            <button type="button" className="btn-key btn-key-primary shrink-0 text-xs"
              onClick={() => window.location.assign(`/discover/?tab=sources&q=${encodeURIComponent(g.title)}`)} data-request-find>{tr('Find and add')}</button>
            <button type="button" className="btn-key shrink-0 text-xs" onClick={() => setDeclining(g)} data-request-decline>{tr('Decline')}</button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-fog-500">{tr('A request is answered by itself once the series is in the library, and the readers who asked are told.')}</p>
      {declining && (
        <Modal title={tr('Decline “{title}”?', { title: `⁨${declining.title}⁩` })} onClose={() => setDeclining(null)}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder={tr('Why, for the readers who asked (optional)')}
            aria-label={tr('Why, for the readers who asked (optional)')} className="field w-full" />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDeclining(null)} className="btn-key">{tr('Cancel')}</button>
            <button type="button" onClick={() => void decline()} className="btn-key btn-key-primary">{tr('Decline')}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
