// The nightly repair's chosen hour: only a whole hour 0-23 counts, anything else is "no hour" (the REPAIR_HOURS rhythm).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@localhost:1/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

test('repairHourOf accepts 0-23 and treats everything else as no hour', async () => {
  const { repairHourOf } = await import('../src/lib/repair');
  assert.equal(repairHourOf(0), 0);
  assert.equal(repairHourOf(3), 3);
  assert.equal(repairHourOf(23), 23);
  for (const v of [null, undefined, 24, -1, 2.5, '3', NaN]) assert.equal(repairHourOf(v), null, String(v));
});

test('with an hour set the next run is that hour, however late the last one ended', async () => {
  const { msUntilHour } = await import('../src/lib/backup');
  const at = new Date(2026, 9, 28, 18, 16, 0);
  const next = new Date(at.getTime() + msUntilHour(3, at));
  assert.deepEqual([next.getDate(), next.getHours(), next.getMinutes()], [29, 3, 0]);
});
