'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { t as tr } from '@/lib/i18n';
import { useToast } from './Toast';
import { IcPlus } from './icons';

interface Note { id: string; book_id: string | null; body: string; updated_at: string }

/**
 * Your own notes on a series, under its description: where you heard of it, what you make of it. Private to the
 * account, and the same notes the Series Bookmarks page lists (the `notes` rows with no chapter), so a note written in
 * either place shows in both.
 */
export function SeriesNotes({ seriesId }: { seriesId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['notes', seriesId],
    queryFn: () => api<{ content: Note[] }>(`/api/notes?seriesId=${encodeURIComponent(seriesId)}`),
  });
  // A note written against a chapter belongs to that chapter's page, not to the series as a whole.
  const notes = (data?.content ?? []).filter((n) => !n.book_id);
  const [draft, setDraft] = useState<{ id: string | null; body: string } | null>(null);

  const settle = () => qc.invalidateQueries({ queryKey: ['notes'] });
  const save = useMutation({
    mutationFn: (d: { id: string | null; body: string }) => d.id
      ? api(`/api/notes/${encodeURIComponent(d.id)}`, { method: 'PATCH', json: { body: d.body.trim() } })
      : api('/api/notes', { json: { seriesId, body: d.body.trim() } }),
    onSuccess: () => { setDraft(null); settle(); },
    // The draft stays in the box, so a refused write does not also lose what was typed.
    onError: () => toast(tr('Could not save that note'), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: settle,
    onError: () => toast(tr('Could not do that'), 'error'),
  });

  return (
    <section aria-label={tr('My notes')} className="max-w-3xl" data-hook="series-notes">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fog-500">{tr('My notes')}</h2>
      {notes.length > 0 && (
        <ul className="mb-2 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="card p-3">
              {draft?.id === n.id ? null : (
                <>
                  <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-fog-200">{n.body}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-fog-500">
                    <span className="me-auto tabular-nums">{relativeTime(n.updated_at)}</span>
                    <button type="button" onClick={() => setDraft({ id: n.id, body: n.body })} className="chip text-xs">{tr('Edit note')}</button>
                    <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(n.id)} className="chip text-xs text-fog-500">{tr('Delete note')}</button>
                  </div>
                </>
              )}
              {draft?.id === n.id && <Editor draft={draft} setDraft={setDraft} busy={save.isPending} onSave={() => save.mutate(draft)} />}
            </li>
          ))}
        </ul>
      )}
      {draft && draft.id === null
        ? <div className="card p-3"><Editor draft={draft} setDraft={setDraft} busy={save.isPending} onSave={() => save.mutate(draft)} /></div>
        : (
          <button type="button" onClick={() => setDraft({ id: null, body: '' })} className="chip inline-flex items-center gap-1.5 text-xs">
            <IcPlus width={13} height={13} />{tr('Add a note')}
          </button>
        )}
    </section>
  );
}

function Editor({ draft, setDraft, busy, onSave }: {
  draft: { id: string | null; body: string }; setDraft: (d: { id: string | null; body: string } | null) => void; busy: boolean; onSave: () => void;
}) {
  return (
    <>
      <textarea autoFocus value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={3} maxLength={4000}
        aria-label={tr('Add a note')} placeholder={tr('Where you heard of it, what you think of it…')} className="field w-full resize-y text-sm" />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => setDraft(null)} className="chip text-xs text-fog-500">{tr('Cancel')}</button>
        <button type="button" disabled={!draft.body.trim() || busy} onClick={onSave} className="btn-accent text-xs disabled:opacity-50">{tr('Save')}</button>
      </div>
    </>
  );
}
