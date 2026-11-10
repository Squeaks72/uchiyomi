'use client';
// Admin → Settings → Maintenance → BookOrbit sync (bff lib/bookorbitSync.ts): reading state kept the same in Uchiyomi and
// BookOrbit, both ways. The passwords are written here and never shown again.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { t as tr } from '@/lib/i18n';
import { useToast } from '@/components/Toast';
import { msgOf } from '@/components/ConfirmDialog';

interface View {
  configured: boolean; enabled: boolean; url: string; username: string; pathPrefix: string; hasPassword: boolean; hasDb: boolean;
  lastRun: string | null; lastError: string | null; running: boolean;
  lastResult: { pushed: number; pulled: number; skipped: number; superseded: number; full: boolean } | null;
}
const KEY = ['admin-bookorbit-sync'];
const DB_HINT = 'postgres://user:password@bookorbit-db:5432/bookorbit';
const field = 'w-full rounded border border-ink-700 bg-transparent px-2 py-1.5 text-sm text-fog-100';

export function BookOrbitSync() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api<View>('/api/admin/bookorbit-sync'), refetchInterval: 15000 });
  const [form, setForm] = useState<{ url?: string; username?: string; password?: string; dbUrl?: string; pathPrefix?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return null;
  const val = (k: 'url' | 'username' | 'pathPrefix') => form[k] ?? data[k];
  const dirty = Object.values(form).some((v) => v !== undefined);

  const act = async (what: string, fn: () => Promise<void>, fail: string) => {
    setBusy(what);
    try { await fn(); } catch (e: any) {
      let msg = msgOf(e, fail);
      try { const b = JSON.parse(e?.body || '{}'); if (b.message) msg = b.message; } catch {}
      toast(msg, 'error');
    }
    setBusy(null);
  };
  const save = (extra: Record<string, unknown> = {}) => act('save', async () => {
    await api('/api/admin/bookorbit-sync', { method: 'PUT', json: { ...form, ...extra } });
    setForm({});
    await qc.invalidateQueries({ queryKey: KEY });
  }, tr('Could not save'));
  const test = () => act('test', async () => {
    const r = await api<{ ok: boolean; message: string }>('/api/admin/bookorbit-sync/test', { method: 'POST', json: {} });
    toast(r.message, r.ok ? 'success' : 'error');
  }, tr('Could not test the connection'));
  const run = () => act('run', async () => {
    const r = await api<{ pushed?: number; pulled?: number; error?: string; busy?: boolean }>('/api/admin/bookorbit-sync/run', { method: 'POST', json: {} });
    if (r.error) toast(r.error, 'error');
    else if (r.busy) toast(tr('A sync is already running'), 'info');
    else toast(tr('Sent to BookOrbit: {a} · Received: {b}', { a: r.pushed ?? 0, b: r.pulled ?? 0 }), 'success');
    await qc.invalidateQueries({ queryKey: KEY });
  }, tr('Could not sync'));

  return (
    <div className="space-y-3 px-1 py-2" id="bookorbit-sync">
      <p className="max-w-prose text-xs text-fog-500">
        {tr('Keeps your reading place and finished chapters the same in Uchiyomi and BookOrbit, in both directions. Chapters are matched by file path, so only series BookOrbit also holds are synced. The newest change wins, and a finished chapter is never marked unread.')}
      </p>
      <label className="flex items-center gap-2 text-sm text-fog-200">
        <input type="checkbox" checked={data.enabled} disabled={!!busy || !data.hasPassword || !data.hasDb || !data.url}
          onChange={(e) => save({ enabled: e.target.checked })} />
        {tr('Sync with BookOrbit')}
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-fog-500">{tr('BookOrbit address')}
          <input className={field} value={val('url')} placeholder="http://bookorbit:3000" onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
        </label>
        <label className="text-xs text-fog-500">{tr('BookOrbit username')}
          <input className={field} value={val('username')} autoComplete="off" onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
        </label>
        <label className="text-xs text-fog-500">{tr('BookOrbit password')}
          <input className={field} type="password" autoComplete="new-password" value={form.password ?? ''}
            placeholder={data.hasPassword ? tr('Saved. Type to replace it.') : ''} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        </label>
        <label className="text-xs text-fog-500">{tr('BookOrbit database (read-only)')}
          <input className={field} type="password" autoComplete="new-password" value={form.dbUrl ?? ''}
            placeholder={data.hasDb ? tr('Saved. Type to replace it.') : DB_HINT} onChange={(e) => setForm((f) => ({ ...f, dbUrl: e.target.value }))} />
        </label>
        <label className="text-xs text-fog-500 sm:col-span-2">{tr('Where the downloads folder is inside BookOrbit')}
          <input className={field} value={val('pathPrefix')} dir="ltr" onChange={(e) => setForm((f) => ({ ...f, pathPrefix: e.target.value }))} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="chip text-xs disabled:opacity-50" disabled={!dirty || !!busy} onClick={() => save()}>{busy === 'save' ? tr('Saving…') : tr('Save')}</button>
        <button className="chip text-xs disabled:opacity-50" disabled={dirty || !!busy || !data.hasPassword || !data.hasDb} onClick={test}>{busy === 'test' ? tr('Testing…') : tr('Test connection')}</button>
        <button className="chip text-xs disabled:opacity-50" disabled={dirty || !!busy || !data.enabled} onClick={run}>{busy === 'run' ? tr('Syncing…') : tr('Sync everything now')}</button>
      </div>
      {data.enabled && (
        <p className={`text-xs ${data.lastError ? 'text-amber-300' : 'text-fog-500'}`}>
          {data.lastError
            ? tr('Last attempt failed: {error}', { error: data.lastError })
            : data.lastRun
              ? tr('Last checked {when}. Sent to BookOrbit: {a} · Received: {b}', { when: relativeTime(data.lastRun), a: data.lastResult?.pushed ?? 0, b: data.lastResult?.pulled ?? 0 })
              : tr('Waiting for the first check.')}
        </p>
      )}
    </div>
  );
}
