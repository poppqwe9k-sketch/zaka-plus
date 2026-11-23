import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_FREE_CREDITS,
  REWARD_CREDITS_AMOUNT,
  consumeOneCredit,
  getLocalDateKey,
  grantRewardCredits,
  isCreditRequiredAction,
  normalizeCreditsState
} from './credits.js';

test('initializes with 5 daily free credits for current date', () => {
  const today = getLocalDateKey(new Date(2026, 10, 22));
  const state = normalizeCreditsState(null, today);
  assert.equal(state.remaining, DAILY_FREE_CREDITS);
  assert.equal(state.lastResetDate, '2026-11-22');
  assert.equal(state.adsWatched, 0);
});

test('resets depleted credits to 5 on a new calendar day while preserving surplus reward credits', () => {
  const depleted = { remaining: 0, lastResetDate: '2026-11-21', adsWatched: 1, totalUsed: 5 };
  const rolledOver = normalizeCreditsState(depleted, '2026-11-22');
  assert.equal(rolledOver.remaining, DAILY_FREE_CREDITS);
  assert.equal(rolledOver.lastResetDate, '2026-11-22');
  assert.equal(rolledOver.adsWatched, 1);

  const surplus = { remaining: 8, lastResetDate: '2026-11-21', adsWatched: 2, totalUsed: 7 };
  const keptSurplus = normalizeCreditsState(surplus, '2026-11-22');
  assert.equal(keptSurplus.remaining, 8);
});

test('requires credits only for Plus Max and image generation, keeping Plus/Plus Plus unlimited', () => {
  assert.equal(isCreditRequiredAction({ wantsImage: true, selectedModel: 'plus' }), true);
  assert.equal(isCreditRequiredAction({ wantsImage: false, selectedModel: 'plus-max' }), true);
  assert.equal(isCreditRequiredAction({ wantsImage: false, selectedModel: 'plus' }), false);
  assert.equal(isCreditRequiredAction({ wantsImage: false, selectedModel: 'plus-plus' }), false);
});

test('consumes single credits cleanly and grants +5 reward credits', () => {
  let state = normalizeCreditsState(null, '2026-11-22');
  for (let i = 0; i < 6; i += 1) {
    state = consumeOneCredit(state, '2026-11-22');
  }
  assert.equal(state.remaining, 0);

  state = grantRewardCredits(state, REWARD_CREDITS_AMOUNT, '2026-11-22');
  assert.equal(state.remaining, 5);
  assert.equal(state.adsWatched, 1);
});
