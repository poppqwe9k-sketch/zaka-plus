import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_TIER,
  FAST_MODEL_CONFIG,
  FAST_MODEL_TIER,
  FIXED_MODEL_CONFIG,
  GEMINI_BACKUP_LITE_MODEL_ID,
  GEMINI_FALLBACK_LITE_MODEL_ID,
  GEMINI_HYDROGEN_MODEL_ID,
  GEMINI_MODEL_ID,
  MODEL_SELECTOR_OPTIONS,
  MODEL_TIERS,
  SUPER_MODEL_TIER,
  normalizeModelTier,
  resolveTierConfig
} from './modelTiers.js';

test('configures بلس (gemini-3.5-flash-lite) as default and بلس بلاس (gemini-4-hydrogen) with lite auto-fallback', () => {
  assert.equal(GEMINI_HYDROGEN_MODEL_ID, 'gemini-4-hydrogen');
  assert.equal(GEMINI_FALLBACK_LITE_MODEL_ID, 'gemini-3.5-flash-lite');
  assert.equal(GEMINI_BACKUP_LITE_MODEL_ID, 'gemini-3.1-flash-lite');
  assert.equal(GEMINI_MODEL_ID, 'gemini-4-hydrogen');
  assert.equal(DEFAULT_MODEL_TIER, FAST_MODEL_TIER);
  assert.equal(MODEL_TIERS.length, 2);
  assert.equal(MODEL_SELECTOR_OPTIONS.length, 2);
  assert.equal(MODEL_SELECTOR_OPTIONS[0].id, FAST_MODEL_TIER);
  assert.equal(MODEL_SELECTOR_OPTIONS[1].id, SUPER_MODEL_TIER);
  assert.equal(FAST_MODEL_CONFIG.labelAr, 'بلس');
  assert.equal(FAST_MODEL_CONFIG.model, 'gemini-3.5-flash-lite');
  assert.equal(FIXED_MODEL_CONFIG.labelAr, 'بلس بلاس');
  assert.equal(FIXED_MODEL_CONFIG.model, 'gemini-4-hydrogen');
  assert.deepEqual(FIXED_MODEL_CONFIG.fallbackModels, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
});

test('resolves default بلس, بلس بلاس standard, and بلس بلاس deep thinking configs accurately', () => {
  const defaultFast = resolveTierConfig(undefined, false);
  assert.equal(defaultFast.tierId, FAST_MODEL_TIER);
  assert.equal(defaultFast.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(defaultFast.fallbackModels, ['gemini-3.1-flash-lite']);
  assert.equal(defaultFast.deepThinking, false);

  const superNormal = resolveTierConfig('plus-max', false);
  assert.equal(superNormal.tierId, SUPER_MODEL_TIER);
  assert.equal(superNormal.model, 'gemini-4-hydrogen');
  assert.deepEqual(superNormal.fallbackModels, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  assert.equal(superNormal.thinkingLevel, 'LOW');
  assert.equal(superNormal.deepThinking, false);

  const superDeep = resolveTierConfig('plus-max', true);
  assert.equal(superDeep.model, 'gemini-4-hydrogen');
  assert.equal(superDeep.thinkingLevel, 'XHIGH');
  assert.equal(superDeep.deepThinking, true);
});

test('normalizes default and legacy tiers to بلس while mapping plus-max / plus-plus to بلس بلاس', () => {
  assert.equal(normalizeModelTier('plus'), DEFAULT_MODEL_TIER);
  assert.equal(normalizeModelTier('unknown'), DEFAULT_MODEL_TIER);
  assert.equal(normalizeModelTier(undefined), DEFAULT_MODEL_TIER);
  assert.equal(normalizeModelTier('plus-fast'), FAST_MODEL_TIER);
  assert.equal(normalizeModelTier('gemini-3.5-flash-lite'), FAST_MODEL_TIER);
  assert.equal(normalizeModelTier('gemini-2.5-flash-lite'), FAST_MODEL_TIER);
  assert.equal(normalizeModelTier('plus-max'), SUPER_MODEL_TIER);
  assert.equal(normalizeModelTier('plus-plus'), SUPER_MODEL_TIER);
  assert.equal(normalizeModelTier('gemini-4-hydrogen'), SUPER_MODEL_TIER);
});
