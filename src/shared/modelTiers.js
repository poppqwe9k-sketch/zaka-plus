export const GEMINI_HYDROGEN_MODEL_ID = 'gemini-4-hydrogen';
export const GEMINI_MODEL_ID = GEMINI_HYDROGEN_MODEL_ID;
export const DEFAULT_MODEL_TIER = 'plus-max';

export const FIXED_MODEL_CONFIG = {
  id: 'plus-max',
  model: GEMINI_HYDROGEN_MODEL_ID,
  fallbackModels: [],
  labelAr: 'Plus AI',
  labelEn: 'Plus AI',
  thinkingLevel: 'LOW',
  deepThinkingLevel: 'XHIGH'
};

export const MODEL_TIERS = [FIXED_MODEL_CONFIG];

export function normalizeModelTier() {
  return DEFAULT_MODEL_TIER;
}

export function getModelTier() {
  return FIXED_MODEL_CONFIG;
}

export function resolveTierConfig(_selectedModel, deepThinking = false) {
  return {
    tierId: FIXED_MODEL_CONFIG.id,
    model: GEMINI_HYDROGEN_MODEL_ID,
    fallbackModel: null,
    fallbackModels: [],
    thinkingLevel: deepThinking ? FIXED_MODEL_CONFIG.deepThinkingLevel : FIXED_MODEL_CONFIG.thinkingLevel,
    thinkingBudget: null,
    fallbackThinkingBudget: null,
    labelAr: FIXED_MODEL_CONFIG.labelAr,
    labelEn: FIXED_MODEL_CONFIG.labelEn
  };
}
