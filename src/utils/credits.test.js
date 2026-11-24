import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDITS_CYCLE_MS,
  DAILY_FREE_CREDITS,
  consumeOneCredit,
  getLocalDateKey,
  isCreditRequiredAction,
  isCreditsCycleExpired,
  normalizeCreditsState
} from './credits.js';

test('initializes with 3 daily free credits for new user with 24h cycle timestamps', () => {
  const t0 = Date.UTC(2026, 10, 23, 12, 0, 0);
  const today = getLocalDateKey(new Date(t0));
  const state = normalizeCreditsState(null, today, t0);
  assert.equal(DAILY_FREE_CREDITS, 3);
  assert.equal(state.remaining, 3);
  assert.equal(state.lastResetDate, today);
  assert.equal(state.cycleStartedAt, t0);
  assert.equal(state.resetAt, t0 + CREDITS_CYCLE_MS);
});

test('deducts 1 message per send and renews depleted credits to 3 after 24 hours', () => {
  const t0 = Date.UTC(2026, 10, 23, 12, 0, 0);
  const today = getLocalDateKey(new Date(t0));
  let state = normalizeCreditsState(null, today, t0);
  assert.equal(state.remaining, 3);

  state = consumeOneCredit(state, today, t0 + 1000);
  assert.equal(state.remaining, 2);
  state = consumeOneCredit(state, today, t0 + 2000);
  assert.equal(state.remaining, 1);
  state = consumeOneCredit(state, today, t0 + 3000);
  assert.equal(state.remaining, 0);
  assert.equal(state.totalUsed, 3);

  // Before 24 hours pass, balance remains 0
  const almost24h = t0 + CREDITS_CYCLE_MS - 60_000;
  assert.equal(isCreditsCycleExpired(state, today, almost24h), false);
  const stillDepleted = normalizeCreditsState(state, today, almost24h);
  assert.equal(stillDepleted.remaining, 0);

  // Once 24 hours pass, balance renews back to 3
  const after24h = t0 + CREDITS_CYCLE_MS;
  const nextDay = getLocalDateKey(new Date(after24h));
  assert.equal(isCreditsCycleExpired(state, nextDay, after24h), true);
  const renewed = normalizeCreditsState(state, nextDay, after24h);
  assert.equal(renewed.remaining, 3);
  assert.equal(renewed.cycleStartedAt, after24h);
  assert.equal(renewed.resetAt, after24h + CREDITS_CYCLE_MS);
});

test('resets depleted credits to 3 on a new calendar day while preserving admin-upgraded surplus credits', () => {
  const depleted = { remaining: 0, lastResetDate: '2026-11-21', totalUsed: 3 };
  const rolledOver = normalizeCreditsState(depleted, '2026-11-22');
  assert.equal(rolledOver.remaining, DAILY_FREE_CREDITS);
  assert.equal(rolledOver.lastResetDate, '2026-11-22');

  const surplus = { remaining: 8, lastResetDate: '2026-11-21', totalUsed: 7 };
  const keptSurplus = normalizeCreditsState(surplus, '2026-11-22');
  assert.equal(keptSurplus.remaining, 8);
});

test('requires credits only for Plus Max and image generation, keeping Plus/Plus Plus flag helper consistent', () => {
  assert.equal(isCreditRequiredAction({ wantsImage: true, selectedModel: 'plus' }), true);
  assert.equal(isCreditRequiredAction({ wantsImage: false, selectedModel: 'plus-max' }), true);
  assert.equal(isCreditRequiredAction({ wantsImage: false, selectedModel: 'plus' }), false);
  assert.equal(isCreditRequiredAction({ wantsImage: false, selectedModel: 'plus-plus' }), false);
});

test('clamps consumed credits cleanly at zero without negative balance', () => {
  const t0 = Date.UTC(2026, 10, 22, 10, 0, 0);
  let state = normalizeCreditsState(null, '2026-11-22', t0);
  for (let i = 0; i < 4; i += 1) {
    state = consumeOneCredit(state, '2026-11-22', t0 + i * 1000);
  }
  assert.equal(state.remaining, 0);
});
