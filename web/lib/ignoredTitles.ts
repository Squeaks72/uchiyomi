import type { QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { titleKey } from '@/lib/hiddenTitles';

/**
 * Ignore (or stop ignoring) a title that is not in the library. The card leaves the screen at once -- the cached key
 * set is updated first -- and is put back if the server refuses.
 */
export async function setTitleIgnored(qc: QueryClient, title: string, ignored: boolean): Promise<void> {
  const before = qc.getQueryData<Set<string>>(['ignored-titles']);
  const next = new Set(before ?? []);
  if (ignored) next.add(titleKey(title)); else next.delete(titleKey(title));
  qc.setQueryData(['ignored-titles'], next);
  try {
    await api('/api/ignored-titles', { method: 'PUT', json: { title, ignored } });
  } catch (e) {
    qc.setQueryData(['ignored-titles'], before);
    throw e;
  }
  qc.invalidateQueries({ queryKey: ['ignored-titles-list'] });
}
