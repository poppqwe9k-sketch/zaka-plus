import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateExchangeCharCount,
  formatPacificResetCountdown,
  getBaghdadResetTimeLabel,
  getNextPacificResetMs,
  getPacificCycleStartMs,
  getPacificDateKey,
  isPacificCycleExpired
} from './pacificTime.js';

test('computes exact America/Los_Angeles midnight cycle start and Baghdad UTC+3 reset time', () => {
  // 2026-11-25 10:59:59 Baghdad (UTC+3) === 2026-11-25 07:59:59 UTC === 2026-11-24 23:59:59 PST (UTC-8)
  const beforeReset = Date.UTC(2026, 10, 25, 7, 59, 59);
  assert.equal(getPacificDateKey(beforeReset), '2026-11-24');

  // 2026-11-25 11:00:00 Baghdad (UTC+3) === 2026-11-25 08:00:00 UTC === 2026-11-25 00:00:00 PST (UTC-8)
  const exactReset = Date.UTC(2026, 10, 25, 8, 0, 0);
  assert.equal(getPacificDateKey(exactReset), '2026-11-25');
  assert.equal(getPacificCycleStartMs(exactReset), exactReset);
  assert.equal(getNextPacificResetMs(beforeReset), exactReset);
  assert.equal(getBaghdadResetTimeLabel(exactReset), '11:00');
});

test('detects PT midnight expiration accurately even for partial cycles started mid-day', () => {
  // Started at 15:00 PST on 2026-11-24 (23:00 UTC) -> still expires only 9 hours later at 00:00 PST 2026-11-25 (08:00 UTC)
  const midDayStart = Date.UTC(2026, 10, 24, 23, 0, 0);
  const justBeforeMidnightPt = Date.UTC(2026, 10, 25, 7, 59, 59);
  const atMidnightPt = Date.UTC(2026, 10, 25, 8, 0, 0);

  assert.equal(isPacificCycleExpired(midDayStart, '2026-11-24', justBeforeMidnightPt), false);
  assert.equal(isPacificCycleExpired(midDayStart, '2026-11-24', atMidnightPt), true);
  assert.equal(isPacificCycleExpired(midDayStart, '', atMidnightPt), true);
  assert.equal(isPacificCycleExpired(0, '', atMidnightPt), true);
});

test('formats live HH:MM:SS countdown until Google PT midnight and counts exchange characters', () => {
  // 1 hour, 2 minutes, 3 seconds before 2026-11-25 00:00:00 PST (08:00:00 UTC)
  const now = Date.UTC(2026, 10, 25, 6, 57, 57);
  const countdown = formatPacificResetCountdown(now);
  assert.equal(countdown.formatted, '01:02:03');
  assert.equal(countdown.baghdadResetTime, '11:00');
  assert.equal(countdown.ptDateKey, '2026-11-24');

  assert.equal(calculateExchangeCharCount('مرحبا بك', 'أهلاً وسهلاً!'), 21);
  assert.equal(calculateExchangeCharCount('', 'رد'), 2);
});
