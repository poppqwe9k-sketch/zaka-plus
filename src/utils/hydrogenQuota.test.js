import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_HYDROGEN_LIMIT,
  MODEL_FLASH_LITE,
  MODEL_HYDROGEN,
  doesHydrogenQuotaNeedReset,
  exhaustHydrogenQuotaToday,
  getHydrogenRemainingToday,
  getHydrogenUsedToday,
  getLocalCalendarDateString,
  getProfileHydrogenQuotaState,
  getTodayKey,
  incrementHydrogenUsedToday,
  reconcileCreditsWithHydrogenQuota,
  shouldDeductHydrogenAttempt
} from './hydrogenQuota.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, val) {
      map.set(key, String(val));
    },
    clear() {
      map.clear();
    }
  };
}

test('exposes expected model IDs and daily limit of 3', () => {
  assert.equal(DAILY_HYDROGEN_LIMIT, 3);
  assert.equal(MODEL_HYDROGEN, 'gemini-4-hydrogen');
  assert.equal(MODEL_FLASH_LITE, 'gemini-3.5-flash-lite');
});

test('tracks daily gemini-4-hydrogen usage in localStorage by local calendar date and resets next day', () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = createMemoryStorage();
  try {
    const day1 = new Date(2026, 10, 27, 10, 0, 0);
    const day2 = new Date(2026, 10, 28, 0, 5, 0);

    assert.equal(getTodayKey(day1), 'zaka_plus_hydrogen_2026-11-27');
    assert.equal(getHydrogenUsedToday(day1), 0);
    assert.equal(getHydrogenRemainingToday(day1), 3);

    assert.equal(incrementHydrogenUsedToday(day1), 1);
    assert.equal(incrementHydrogenUsedToday(day1), 2);
    assert.equal(getHydrogenRemainingToday(day1), 1);

    assert.equal(incrementHydrogenUsedToday(day1), 3);
    // Clamps cleanly at DAILY_HYDROGEN_LIMIT
    assert.equal(incrementHydrogenUsedToday(day1), 3);
    assert.equal(getHydrogenUsedToday(day1), 3);
    assert.equal(getHydrogenRemainingToday(day1), 0);

    // Resets automatically on a new calendar day
    assert.equal(getTodayKey(day2), 'zaka_plus_hydrogen_2026-11-28');
    assert.equal(getHydrogenUsedToday(day2), 0);
    assert.equal(getHydrogenRemainingToday(day2), 3);

    // Exhausts immediately when server falls back to lite
    assert.equal(exhaustHydrogenQuotaToday(day2), 3);
    assert.equal(getHydrogenUsedToday(day2), 3);
    assert.equal(getHydrogenRemainingToday(day2), 0);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test('reconcileCreditsWithHydrogenQuota caps free users to remaining today while preserving upgraded plans', () => {
  const freeState = { remaining: 3, dailyLimit: 3 };
  assert.deepEqual(reconcileCreditsWithHydrogenQuota(freeState, 3, 1), {
    remaining: 1,
    dailyLimit: 3
  });

  const proState = { remaining: 20, dailyLimit: 25 };
  assert.equal(reconcileCreditsWithHydrogenQuota(proState, 25, 0), proState);
});

test('shouldDeductHydrogenAttempt returns false for 400/401/403/429/502 errors, ok:false, empty replies, or fallback model', () => {
  assert.equal(
    shouldDeductHydrogenAttempt({
      responseOk: false,
      ok: false,
      status: 400,
      replyText: 'API key not valid. Please pass a valid API key. (400)',
      usedFallback: false,
      usedModel: MODEL_HYDROGEN
    }),
    false
  );
  assert.equal(
    shouldDeductHydrogenAttempt({
      responseOk: true,
      ok: false,
      status: 200,
      replyText: 'Some error',
      usedFallback: false,
      usedModel: MODEL_HYDROGEN
    }),
    false
  );
  for (const status of [400, 401, 403, 429, 502]) {
    assert.equal(
      shouldDeductHydrogenAttempt({
        responseOk: true,
        ok: true,
        status,
        replyText: 'ignored',
        usedFallback: false,
        usedModel: MODEL_HYDROGEN
      }),
      false
    );
  }
  assert.equal(
    shouldDeductHydrogenAttempt({
      responseOk: true,
      ok: true,
      status: 200,
      replyText: '   ',
      usedFallback: false,
      usedModel: MODEL_HYDROGEN
    }),
    false
  );
  assert.equal(
    shouldDeductHydrogenAttempt({
      responseOk: true,
      ok: true,
      status: 200,
      replyText: 'تم الرد من بلس',
      usedFallback: true,
      usedModel: MODEL_FLASH_LITE
    }),
    false
  );
  assert.equal(
    shouldDeductHydrogenAttempt({
      responseOk: true,
      ok: true,
      status: 200,
      replyText: 'تم الرد من بلس',
      usedFallback: false,
      usedModel: MODEL_FLASH_LITE
    }),
    false
  );
  assert.equal(
    shouldDeductHydrogenAttempt({
      responseOk: true,
      ok: true,
      status: 200,
      replyText: 'إجابة ناجحة من هيدروجين',
      usedFallback: false,
      usedModel: MODEL_HYDROGEN
    }),
    true
  );
});

test('resolves Firestore users/{uid} hydrogenUsedCount & hydrogenQuotaDate and resets cleanly on a new YYYY-MM-DD date', () => {
  const today = getLocalCalendarDateString(new Date(2026, 10, 27));
  const yesterday = getLocalCalendarDateString(new Date(2026, 10, 26));

  assert.equal(doesHydrogenQuotaNeedReset({ hydrogenUsedCount: 2, hydrogenQuotaDate: today }, today), false);
  assert.equal(doesHydrogenQuotaNeedReset({ hydrogenUsedCount: 3, hydrogenQuotaDate: yesterday }, today), true);
  assert.equal(doesHydrogenQuotaNeedReset({ remainingCredits: 1, lastResetDate: today }, today), true);

  const sameDayActive = getProfileHydrogenQuotaState(
    { hydrogenUsedCount: 2, hydrogenQuotaDate: today, dailyLimit: 3 },
    today,
    3
  );
  assert.deepEqual(sameDayActive, {
    used: 2,
    remaining: 1,
    limit: 3,
    quotaDate: today,
    needsReset: false
  });

  const sameDayExhausted = getProfileHydrogenQuotaState(
    { hydrogenUsedCount: 3, hydrogenQuotaDate: today, dailyLimit: 3 },
    today,
    3
  );
  assert.equal(sameDayExhausted.used, 3);
  assert.equal(sameDayExhausted.remaining, 0);
  assert.equal(sameDayExhausted.needsReset, false);

  const rolledOverDay = getProfileHydrogenQuotaState(
    { hydrogenUsedCount: 3, hydrogenQuotaDate: yesterday, dailyLimit: 3 },
    today,
    3
  );
  assert.deepEqual(rolledOverDay, {
    used: 0,
    remaining: 3,
    limit: 3,
    quotaDate: today,
    needsReset: true
  });

  const legacySameDay = getProfileHydrogenQuotaState(
    { remainingCredits: 1, lastResetDate: today, dailyLimit: 3 },
    today,
    3
  );
  assert.deepEqual(legacySameDay, {
    used: 2,
    remaining: 1,
    limit: 3,
    quotaDate: today,
    needsReset: true
  });
});
