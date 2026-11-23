import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_TIER,
  FIXED_MODEL_CONFIG,
  GEMINI_HYDROGEN_MODEL_ID,
  GEMINI_MODEL_ID,
  MODEL_TIERS,
  normalizeModelTier,
  resolveTierConfig
} from './modelTiers.js';

test('locks application to single fixed gemini-4-hydrogen model with no fallback tiers', () => {
  assert.equal(GEMINI_HYDROGEN_MODEL_ID, 'gemini-4-hydrogen');
  assert.equal(GEMINI_MODEL_ID, 'gemini-4-hydrogen');
  assert.equal(MODEL_TIERS.length, 1);
  assert.equal(FIXED_MODEL_CONFIG.model, 'gemini-4-hydrogen');
  assert.deepEqual(FIXED_MODEL_CONFIG.fallbackModels, []);
});

test('resolves standard and deep thinking configs exclusively for gemini-4-hydrogen', () => {
  const normal = resolveTierConfig('anything', false);
  assert.equal(normal.model, 'gemini-4-hydrogen');
  assert.deepEqual(normal.fallbackModels, []);
  assert.equal(normal.thinkingLevel, 'LOW');

  const deep = resolveTierConfig('plus', true);
  assert.equal(deep.model, 'gemini-4-hydrogen');
  assert.equal(deep.thinkingLevel, 'XHIGH');
});

test('normalizes any model identifier to default fixed tier', () => {
  assert.equal(normalizeModelTier('plus'), DEFAULT_MODEL_TIER);
  assert.equal(normalizeModelTier('unknown'), DEFAULT_MODEL_TIER);
  assert.equal(normalizeModelTier(undefined), DEFAULT_MODEL_TIER);
});
