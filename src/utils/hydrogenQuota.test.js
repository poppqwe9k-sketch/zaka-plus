import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_HYDROGEN_LIMIT,
  MODEL_FLASH_LITE,
  MODEL_HYDROGEN,
  exhaustHydrogenQuotaToday,
  getHydrogenRemainingToday,
  getHydrogenUsedToday,
  getTodayKey,
  incrementHydrogenUsedToday,
  reconcileCreditsWithHydrogenQuota
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
