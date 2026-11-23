import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_FLASH_MODEL_ID,
  GEMINI_HYDROGEN_MODEL_ID,
  GEMINI_PRO_MODEL_ID,
  MODEL_TIERS,
  normalizeModelTier,
  resolveTierConfig
} from './modelTiers.js';

test('defines 3 graduated tiers mapped to gemini-2.5-flash, gemini-2.5-pro, and gemini-4-hydrogen', () => {
  assert.equal(MODEL_TIERS.length, 3);
  assert.deepEqual(
    MODEL_TIERS.map((t) => t.id),
    ['plus', 'plus-plus', 'plus-max']
  );
  assert.deepEqual(
    MODEL_TIERS.map((t) => t.labelAr),
    ['بلس', 'بلس بلاس', 'بلس ماكس']
  );
  assert.equal(GEMINI_FLASH_MODEL_ID, 'gemini-2.5-flash');
  assert.equal(GEMINI_PRO_MODEL_ID, 'gemini-2.5-pro');
  assert.equal(GEMINI_HYDROGEN_MODEL_ID, 'gemini-4-hydrogen');
});

test('resolves tier models, thinking configs, and fallback chains correctly', () => {
  const plus = resolveTierConfig('plus', false);
  assert.equal(plus.model, 'gemini-2.5-flash');
  assert.ok(plus.fallbackModels.includes('gemini-3.1-flash-lite'));
  assert.equal(plus.thinkingBudget, 0);

  const plusDeep = resolveTierConfig('plus', true);
  assert.equal(plusDeep.thinkingBudget, 2048);

  const plusPlus = resolveTierConfig('plus-plus', false);
  assert.equal(plusPlus.model, 'gemini-2.5-pro');
  assert.equal(plusPlus.fallbackModel, 'gemini-2.5-flash');
  assert.equal(plusPlus.thinkingBudget, 4096);

  const plusPlusDeep = resolveTierConfig('plus-plus', true);
  assert.equal(plusPlusDeep.thinkingBudget, 8192);

  const plusMax = resolveTierConfig('plus-max', false);
  assert.equal(plusMax.model, 'gemini-4-hydrogen');
  assert.equal(plusMax.fallbackModel, 'gemini-2.5-flash');
  assert.ok(plusMax.fallbackModels.includes('gemini-3.8-flash'));
  assert.equal(plusMax.thinkingLevel, 'XHIGH');
  assert.equal(plusMax.fallbackThinkingBudget, 8192);
});

test('normalizes legacy and unknown model identifiers safely', () => {
  assert.equal(normalizeModelTier('gemini-3.8-flash'), 'plus');
  assert.equal(normalizeModelTier('deepseek-v4-pro'), 'plus-max');
  assert.equal(normalizeModelTier('unknown-id'), 'plus');
  assert.equal(normalizeModelTier(undefined), 'plus');
});
