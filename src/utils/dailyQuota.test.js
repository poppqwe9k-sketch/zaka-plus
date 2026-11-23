import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_QUOTA_PER_KEY,
  QUOTA_CYCLE_MS,
  applyMessageSendQuota,
  createFreshQuotaState,
  formatDailyQuotaText,
  loadDailyQuotaState,
  reconcileQuotaState,
  saveDailyQuotaState
} from './dailyQuota.js';

test('calculates total daily capacity from valid keys (10 valid keys = 200 messages) and updates dynamically when key count changes', () => {
  const t0 = 1_700_000_000_000;
  const initial = reconcileQuotaState(null, { validKeyCount: 10, exhaustedKeyCount: 0 }, t0);
  assert.equal(DAILY_QUOTA_PER_KEY, 20);
  assert.equal(initial.validKeyCount, 10);
  assert.equal(initial.totalCapacity, 200);
  assert.equal(initial.remaining, 200);
  assert.equal(formatDailyQuotaText(initial.remaining, 'ar'), 'لديك 200 رسالة متبقية (تتجدد كل 24 ساعة)');

  const after3Messages = [1, 2, 3].reduce(
    (acc, idx) => applyMessageSendQuota(acc, { validKeyCount: 10, exhaustedKeyCount: 0, reachedModel: true, succeeded: true }, t0 + idx * 1000),
    initial
  );
  assert.equal(after3Messages.remaining, 197);
  assert.equal(after3Messages.usedCount, 3);

  // Valid key count expands from 10 to 13 -> capacity becomes 260, preserving 3 used messages
  const expanded = reconcileQuotaState(after3Messages, { validKeyCount: 13, exhaustedKeyCount: 0 }, t0 + 10_000);
  assert.equal(expanded.totalCapacity, 260);
  assert.equal(expanded.remaining, 257);

  // Valid key count shrinks from 13 to 5 -> capacity becomes 100, preserving 3 used messages
  const shrunk = reconcileQuotaState(expanded, { validKeyCount: 5, exhaustedKeyCount: 0 }, t0 + 20_000);
  assert.equal(shrunk.totalCapacity, 100);
  assert.equal(shrunk.remaining, 97);
});

test('never decrements counter on empty/pre-model errors, decrements by 1 on real gemini-4-hydrogen success', () => {
  const t0 = 1_700_000_000_000;
  const start = createFreshQuotaState({ validKeyCount: 10, now: t0 });

  // Pre-model failure (e.g., validation error or offline/unconfigured key before reaching model)
  const afterPreModelFailure = applyMessageSendQuota(start, {
    validKeyCount: 10,
    exhaustedKeyCount: 0,
    reachedModel: false,
    succeeded: false
  }, t0 + 1000);
  assert.equal(afterPreModelFailure.remaining, 200);

  // Real model call returns transient 502 without exhausting all keys -> does not fake-decrement
  const afterTransientFail = applyMessageSendQuota(afterPreModelFailure, {
    validKeyCount: 10,
    exhaustedKeyCount: 0,
    reachedModel: true,
    succeeded: false
  }, t0 + 2000);
  assert.equal(afterTransientFail.remaining, 200);

  // Real model reply succeeds -> decrements by 1
  const afterSuccess = applyMessageSendQuota(afterTransientFail, {
    validKeyCount: 10,
    exhaustedKeyCount: 0,
    reachedModel: true,
    succeeded: true
  }, t0 + 3000);
  assert.equal(afterSuccess.remaining, 199);
});

test('aligns remaining quota with server 429 key exhaustion without double-penalizing on subsequent requests', () => {
  const t0 = 1_700_000_000_000;
  const start = createFreshQuotaState({ validKeyCount: 10, now: t0 });

  // Key #1 returned 429 and rotated to Key #2 which succeeded -> key #1 quota (20) is gone + 1 message sent = 179 left
  const afterFirstRotation = applyMessageSendQuota(start, {
    validKeyCount: 10,
    exhaustedKeyCount: 1,
    quota429ThisRequest: 1,
    reachedModel: true,
    succeeded: true
  }, t0 + 1000);
  assert.equal(afterFirstRotation.remaining, 179);

  // Next request still sees exhaustedKeyCount=1 -> only decrements by 1 (178), never wipes another 20
  const afterSecondMessage = applyMessageSendQuota(afterFirstRotation, {
    validKeyCount: 10,
    exhaustedKeyCount: 1,
    quota429ThisRequest: 1,
    reachedModel: true,
    succeeded: true
  }, t0 + 2000);
  assert.equal(afterSecondMessage.remaining, 178);

  // All 10 keys return 429 -> remaining aligns to 0
  const afterAllExhausted = applyMessageSendQuota(afterSecondMessage, {
    validKeyCount: 10,
    exhaustedKeyCount: 10,
    quota429ThisRequest: 10,
    reachedModel: true,
    succeeded: false
  }, t0 + 3000);
  assert.equal(afterAllExhausted.remaining, 0);
});

test('automatically resets remaining quota back to full key capacity after 24 hours', () => {
  const t0 = 1_700_000_000_000;
  const start = createFreshQuotaState({ validKeyCount: 10, now: t0 });
  const depleted = applyMessageSendQuota(start, {
    validKeyCount: 10,
    exhaustedKeyCount: 2,
    reachedModel: true,
    succeeded: true
  }, t0 + 5000);
  assert.equal(depleted.remaining, 159);

  // Just before 24 hours: still on same cycle
  const before24h = reconcileQuotaState(depleted, { validKeyCount: 10, exhaustedKeyCount: 2 }, t0 + QUOTA_CYCLE_MS - 1);
  assert.equal(before24h.cycleStartedAt, t0);
  assert.equal(before24h.remaining, 159);

  // Exactly 24 hours elapsed: even before serverMeta arrives ({}), stale exhaustedKeyCount=10 must NOT carry over
  const depletedAll = applyMessageSendQuota(start, {
    validKeyCount: 10,
    exhaustedKeyCount: 10,
    quota429ThisRequest: 10,
    reachedModel: true,
    succeeded: false
  }, t0 + 6000);
  assert.equal(depletedAll.remaining, 0);
  const clientBootAt24h = reconcileQuotaState(depletedAll, {}, t0 + QUOTA_CYCLE_MS);
  assert.equal(clientBootAt24h.remaining, 200);
  assert.equal(clientBootAt24h.usedCount, 0);
  assert.equal(clientBootAt24h.exhaustedKeyCount, 0);

  // Subsequent server sync within the fresh cycle preserves full 200 and expands cleanly to 260 on 13 keys
  const afterServerSync = reconcileQuotaState(clientBootAt24h, { validKeyCount: 10, exhaustedKeyCount: 0 }, t0 + QUOTA_CYCLE_MS + 50);
  assert.equal(afterServerSync.remaining, 200);
  const after13Keys = reconcileQuotaState(afterServerSync, { validKeyCount: 13, exhaustedKeyCount: 0 }, t0 + QUOTA_CYCLE_MS + 100);
  assert.equal(after13Keys.remaining, 260);
});

test('persists and loads quota state from localStorage safely', () => {
  const store = new Map();
  const mockStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  };
  const state = createFreshQuotaState({ validKeyCount: 10, now: 1_700_000_000_000 });
  saveDailyQuotaState(state, mockStorage);
  const loaded = loadDailyQuotaState(mockStorage);
  assert.deepEqual(loaded, state);
});
