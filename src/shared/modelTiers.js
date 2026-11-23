export const GEMINI_FLASH_MODEL_ID = 'gemini-2.5-flash';
export const GEMINI_PRO_MODEL_ID = 'gemini-2.5-pro';
export const GEMINI_HYDROGEN_MODEL_ID = 'gemini-4-hydrogen';
export const GEMINI_THREE_FLASH_MODEL_ID = 'gemini-3.8-flash';
export const GEMINI_FLASH_LITE_MODEL_ID = 'gemini-3.1-flash-lite';
export const GEMINI_MODEL_ID = GEMINI_HYDROGEN_MODEL_ID;
export const DEFAULT_MODEL_TIER = 'plus';

export const MODEL_TIERS = [
  {
    id: 'plus',
    model: GEMINI_FLASH_MODEL_ID,
    fallbackModels: [GEMINI_FLASH_LITE_MODEL_ID, GEMINI_THREE_FLASH_MODEL_ID],
    labelAr: 'بلس',
    labelEn: 'Plus',
    shortDescAr: 'النموذج السريع والخفيف للمهام اليومية',
    shortDescEn: 'Fast and lightweight for everyday tasks',
    thinkingLevel: 'LOW',
    deepThinkingLevel: 'MEDIUM',
    thinkingBudget: 0,
    deepThinkingBudget: 2048,
    fallbackThinkingBudget: 0,
    capabilitiesAr: 'سرعة فائقة وحصة مجانية كبيرة للأسئلة اليومية',
    capabilitiesEn: 'High speed and generous daily quota for everyday tasks'
  },
  {
    id: 'plus-plus',
    model: GEMINI_PRO_MODEL_ID,
    fallbackModels: [GEMINI_FLASH_MODEL_ID, GEMINI_THREE_FLASH_MODEL_ID, GEMINI_FLASH_LITE_MODEL_ID],
    labelAr: 'بلس بلاس',
    labelEn: 'Plus Plus',
    shortDescAr: 'النموذج المتوسط المتوازن للتحليل والمهام المتقدمة',
    shortDescEn: 'Balanced reasoning for analysis and advanced tasks',
    thinkingLevel: 'MEDIUM',
    deepThinkingLevel: 'HIGH',
    thinkingBudget: 4096,
    deepThinkingBudget: 8192,
    fallbackThinkingBudget: 4096,
    capabilitiesAr: 'توازن مثالي بين العمق التحليلي وسرعة الاستجابة',
    capabilitiesEn: 'Balanced analytical depth and response speed'
  },
  {
    id: 'plus-max',
    model: GEMINI_HYDROGEN_MODEL_ID,
    fallbackModels: [GEMINI_FLASH_MODEL_ID, GEMINI_THREE_FLASH_MODEL_ID, GEMINI_FLASH_LITE_MODEL_ID],
    labelAr: 'بلس ماكس',
    labelEn: 'Plus Max',
    shortDescAr: 'النموذج الأقوى والأكثر عمقاً بقدرات Gemini 4 Hydrogen مع بديل تلقائي',
    shortDescEn: 'Maximum intelligence via Gemini 4 Hydrogen with automatic Flash fallback',
    thinkingLevel: 'XHIGH',
    deepThinkingLevel: 'XHIGH',
    thinkingBudget: 8192,
    deepThinkingBudget: 8192,
    fallbackThinkingBudget: 8192,
    capabilitiesAr: 'أقصى عمق تفكير مع انتقال تلقائي سلس عند تجاوز الحد اليومي',
    capabilitiesEn: 'Maximum reasoning depth with seamless automatic fallback on quota limits'
  }
];

const LEGACY_TIER_MAP = {
  'gemini-3.8-flash': 'plus',
  'gemini-3.1-flash-lite': 'plus',
  'gemini-2.5-flash': 'plus',
  'gemini-2.5-pro': 'plus-plus',
  'deepseek-v4-pro': 'plus-max'
};

export function normalizeModelTier(selectedModel) {
  if (typeof selectedModel !== 'string') return DEFAULT_MODEL_TIER;
  const trimmed = selectedModel.trim();
  if (MODEL_TIERS.some((tier) => tier.id === trimmed)) return trimmed;
  if (Object.prototype.hasOwnProperty.call(LEGACY_TIER_MAP, trimmed)) {
    return LEGACY_TIER_MAP[trimmed];
  }
  return DEFAULT_MODEL_TIER;
}

export function getModelTier(selectedModel) {
  const tierId = normalizeModelTier(selectedModel);
  return MODEL_TIERS.find((tier) => tier.id === tierId) || MODEL_TIERS[0];
}

export function resolveTierConfig(selectedModel, deepThinking = false) {
  const tier = getModelTier(selectedModel);
  const thinkingLevel = deepThinking ? tier.deepThinkingLevel : tier.thinkingLevel;
  const thinkingBudget = deepThinking ? tier.deepThinkingBudget : tier.thinkingBudget;
  return {
    tierId: tier.id,
    model: tier.model,
    fallbackModel: tier.fallbackModels[0] || null,
    fallbackModels: [...tier.fallbackModels],
    thinkingLevel,
    thinkingBudget,
    fallbackThinkingBudget: tier.fallbackThinkingBudget,
    labelAr: tier.labelAr,
    labelEn: tier.labelEn,
    shortDescAr: tier.shortDescAr,
    shortDescEn: tier.shortDescEn
  };
}
