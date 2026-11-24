export const GEMINI_HYDROGEN_MODEL_ID = 'gemini-4-hydrogen';
export const GEMINI_FALLBACK_LITE_MODEL_ID = 'gemini-3.5-flash-lite';
export const GEMINI_BACKUP_LITE_MODEL_ID = 'gemini-3.1-flash-lite';
export const GEMINI_MODEL_ID = GEMINI_HYDROGEN_MODEL_ID;
export const FAST_MODEL_TIER = 'plus-fast';
export const SUPER_MODEL_TIER = 'plus-max';
export const DEFAULT_MODEL_TIER = FAST_MODEL_TIER;

export const FAST_MODEL_CONFIG = {
  id: FAST_MODEL_TIER,
  model: GEMINI_FALLBACK_LITE_MODEL_ID,
  fallbackModels: [GEMINI_BACKUP_LITE_MODEL_ID],
  labelAr: 'بلس',
  labelEn: 'Plus',
  thinkingLevel: null,
  deepThinkingLevel: null
};

export const FIXED_MODEL_CONFIG = {
  id: SUPER_MODEL_TIER,
  model: GEMINI_HYDROGEN_MODEL_ID,
  fallbackModels: [GEMINI_FALLBACK_LITE_MODEL_ID, GEMINI_BACKUP_LITE_MODEL_ID],
  labelAr: 'بلس بلاس',
  labelEn: 'Plus Plus',
  thinkingLevel: 'LOW',
  deepThinkingLevel: 'XHIGH'
};

export const MODEL_TIERS = [FAST_MODEL_CONFIG, FIXED_MODEL_CONFIG];

export const MODEL_SELECTOR_OPTIONS = [
  {
    id: FAST_MODEL_TIER,
    model: GEMINI_FALLBACK_LITE_MODEL_ID,
    nameKey: 'modelFastName',
    subtitleKey: 'modelFastSubtitle',
    descKey: 'modelFastDesc'
  },
  {
    id: SUPER_MODEL_TIER,
    model: GEMINI_HYDROGEN_MODEL_ID,
    nameKey: 'modelProName',
    subtitleKey: 'modelProSubtitle',
    descKey: 'modelProDesc'
  }
];

export function normalizeModelTier(selectedModel) {
  if (
    selectedModel === SUPER_MODEL_TIER
    || selectedModel === 'plus-plus'
    || selectedModel === GEMINI_HYDROGEN_MODEL_ID
  ) {
    return SUPER_MODEL_TIER;
  }
  return DEFAULT_MODEL_TIER;
}

export function getModelTier(selectedModel) {
  return normalizeModelTier(selectedModel) === SUPER_MODEL_TIER
    ? FIXED_MODEL_CONFIG
    : FAST_MODEL_CONFIG;
}

export function resolveTierConfig(selectedModel, deepThinking = false, options = false) {
  const useFallbackOnly = typeof options === 'boolean'
    ? options
    : Boolean(options?.useFallbackOnly);
  const normalizedTier = normalizeModelTier(selectedModel);
  const isFast = useFallbackOnly || normalizedTier === FAST_MODEL_TIER;

  if (isFast) {
    return {
      tierId: FAST_MODEL_CONFIG.id,
      model: GEMINI_FALLBACK_LITE_MODEL_ID,
      fallbackModel: GEMINI_BACKUP_LITE_MODEL_ID,
      fallbackModels: [GEMINI_BACKUP_LITE_MODEL_ID],
      thinkingLevel: null,
      thinkingBudget: null,
      fallbackThinkingBudget: null,
      deepThinking: Boolean(deepThinking),
      labelAr: FAST_MODEL_CONFIG.labelAr,
      labelEn: FAST_MODEL_CONFIG.labelEn
    };
  }

  return {
    tierId: FIXED_MODEL_CONFIG.id,
    model: GEMINI_HYDROGEN_MODEL_ID,
    fallbackModel: GEMINI_FALLBACK_LITE_MODEL_ID,
    fallbackModels: [GEMINI_FALLBACK_LITE_MODEL_ID, GEMINI_BACKUP_LITE_MODEL_ID],
    thinkingLevel: deepThinking ? FIXED_MODEL_CONFIG.deepThinkingLevel : FIXED_MODEL_CONFIG.thinkingLevel,
    thinkingBudget: null,
    fallbackThinkingBudget: null,
    deepThinking: Boolean(deepThinking),
    labelAr: FIXED_MODEL_CONFIG.labelAr,
    labelEn: FIXED_MODEL_CONFIG.labelEn
  };
}
