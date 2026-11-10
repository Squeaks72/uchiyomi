// Waiting for whole volumes (fork, lib/volumes): one account's choice for one series. On, the account hears when a
// volume or arc of the series is complete and nothing about its single chapters (lib/nextUp.ts wantsNews).
import { q, one } from '../db';

/** Whether this account waits for volumes of this series. Fails CLOSED to "no": a lookup that throws keeps the chapter news. */
export async function waitsForVolumes(userId: string, seriesId: string): Promise<boolean> {
  const r = await one<{ x: number }>('SELECT 1 AS x FROM volume_watch WHERE user_id = $1 AND series_id = $2', [userId, seriesId]).catch(() => null);
  return !!r;
}

/** The series of `ids` this account waits on. */
export async function watchedAmong(userId: string, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await q<{ series_id: string }>('SELECT series_id FROM volume_watch WHERE user_id = $1 AND series_id = ANY($2)', [userId, [...ids]]).catch(() => []);
  return new Set(rows.map((r) => r.series_id));
}

export async function setWaitsForVolumes(userId: string, seriesId: string, on: boolean): Promise<void> {
  if (on) await q('INSERT INTO volume_watch (user_id, series_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, seriesId]);
  else await q('DELETE FROM volume_watch WHERE user_id = $1 AND series_id = $2', [userId, seriesId]);
}
