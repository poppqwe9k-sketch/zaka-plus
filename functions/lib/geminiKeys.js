import { GoogleGenAI } from '@google/genai';
import {
  getNextPacificResetMs,
  getPacificCycleStartMs,
  getPacificDateKey,
  isPacificCycleExpired
} from '../../src/utils/pacificTime.js';

export const GEMINI_KEY_COUNT = 19;
export const DAILY_QUOTA_PER_KEY = 20;
export const PLUS_QUOTA_PER_KEY = 1000;
export const QUOTA_CYCLE_MS = 24 * 60 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 15 * 1000;
const AUTH_COOLDOWN_MS = 10 * 60 * 1000;
const GOOGLE_API_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{20,}$/;
const PLACEHOLDER_KEYS = new Set([
  'replace-with-your-private-key',
  'your_api_key',
  'your-api-key',
  'api_key',
  'apikey',
  'placeholder',
  'changeme',
  'change_me',
  'null',
  'undefined',
  'none',
  'nil'
]);

let rotationCursor = 0;
const MODEL_QUOTA_COOLDOWN = new Map();
const GLOBAL_AUTH_COOLDOWN = new Map();
const INVALID_AUTH_KEYS = new Set();
const QUOTA_EXHAUSTED_KEYS_BY_MODEL = new Map();

export function resetKeyRotationForTests() {
  rotationCursor = 0;
  MODEL_QUOTA_COOLDOWN.clear();
  GLOBAL_AUTH_COOLDOWN.clear();
  INVALID_AUTH_KEYS.clear();
  QUOTA_EXHAUSTED_KEYS_BY_MODEL.clear();
}

function getCooldownMapKey(apiKey, model = '') {
  return model ? `${apiKey}::${model}` : apiKey;
}

function normalizeRawKey(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(?:bearer|x-goog-api-key)\s*:?\s+/i, '')
    .trim();
  if (!cleaned || /\s/.test(cleaned)) return '';
  const lower = cleaned.toLowerCase();
  if (PLACEHOLDER_KEYS.has(lower)) return '';
  if (lower.startsWith('replace-with') || lower.startsWith('your_api_key') || lower.startsWith('your-api-key')) {
    return '';
  }
  return cleaned;
}

export function getGeminiApiKeys(env) {
  const hasExplicitEnv = env !== undefined && env !== null;
  const source = hasExplicitEnv && typeof env === 'object'
    ? env
    : (typeof process !== 'undefined' && process.env ? process.env : {});

  const envFallback = !hasExplicitEnv && typeof process !== 'undefined' && process.env ? process.env : {};

  // Explicit static property reads (no dynamic 'GEMINI_KEY_' + i indexing)
  // so every bundler and server runtime resolves all keys reliably.
  const rawSingleKeys = [
    source.GEMINI_KEY ?? envFallback.GEMINI_KEY,
    source.GEMINI_KEY_1 ?? envFallback.GEMINI_KEY_1,
    source.GEMINI_KEY_2 ?? envFallback.GEMINI_KEY_2,
    source.GEMINI_KEY_3 ?? envFallback.GEMINI_KEY_3,
    source.GEMINI_KEY_4 ?? envFallback.GEMINI_KEY_4,
    source.GEMINI_KEY_5 ?? envFallback.GEMINI_KEY_5,
    source.GEMINI_KEY_6 ?? envFallback.GEMINI_KEY_6,
    source.GEMINI_KEY_7 ?? envFallback.GEMINI_KEY_7,
    source.GEMINI_KEY_8 ?? envFallback.GEMINI_KEY_8,
    source.GEMINI_KEY_9 ?? envFallback.GEMINI_KEY_9,
    source.GEMINI_KEY_10 ?? envFallback.GEMINI_KEY_10,
    source.GEMINI_KEY_11 ?? envFallback.GEMINI_KEY_11,
    source.GEMINI_KEY_12 ?? envFallback.GEMINI_KEY_12,
    source.GEMINI_KEY_13 ?? envFallback.GEMINI_KEY_13,
    source.GEMINI_KEY_14 ?? envFallback.GEMINI_KEY_14,
    source.GEMINI_KEY_15 ?? envFallback.GEMINI_KEY_15,
    source.GEMINI_KEY_16 ?? envFallback.GEMINI_KEY_16,
    source.GEMINI_KEY_17 ?? envFallback.GEMINI_KEY_17,
    source.GEMINI_KEY_18 ?? envFallback.GEMINI_KEY_18,
    source.GEMINI_KEY_19 ?? envFallback.GEMINI_KEY_19
  ].filter(Boolean);

  const rawMultiKeys = [
    source.GEMINI_KEYS ?? envFallback.GEMINI_KEYS,
    source.GEMINI_API_KEYS ?? envFallback.GEMINI_API_KEYS
  ]
    .filter((v) => typeof v === 'string' && v.trim())
    .flatMap((v) => v.split(/[,\s]+/));

  const modeCandidate = normalizeRawKey(source.GEMINI_MODE ?? envFallback.GEMINI_MODE);
  const modeKeyIfApiKey = /^AIza[0-9A-Za-z_-]{20,}$/.test(modeCandidate) ? [modeCandidate] : [];

  const fallbackSingleKey = [
    source.GEMINI_API_KEY ?? envFallback.GEMINI_API_KEY
  ].filter(Boolean);

  // Also capture any extra GEMINI_*KEY* secrets (e.g. GEMINI_KEY_20, GEMINI_BACKUP_KEY)
  const extraNamedKeys = [];
  for (const obj of [source, envFallback]) {
    if (!obj || typeof obj !== 'object') continue;
    for (const [envName, envVal] of Object.entries(obj)) {
      if (envName === 'GEMINI_KEYS' || envName === 'GEMINI_API_KEYS') continue;
      if (/^GEMINI_.*(?:COUNT|INDEX|MODE|MODEL|ENABLED|URL|ENDPOINT|LIMIT|TIMEOUT)$/i.test(envName)) continue;
      if (!/^GEMINI_.*KEY/i.test(envName) && !/^GEMINI_?\d+$/i.test(envName)) continue;
      if (typeof envVal === 'string' && envVal.trim()) {
        extraNamedKeys.push(envVal);
      }
    }
  }

  const keys = [];
  const seen = new Set();

  for (const raw of [...rawSingleKeys, ...rawMultiKeys, ...modeKeyIfApiKey, ...fallbackSingleKey, ...extraNamedKeys]) {
    const trimmed = normalizeRawKey(raw);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    keys.push(trimmed);
  }

  // Prioritize valid-format Google AIza... keys first, while keeping any other configured keys as fallback.
  const googleKeys = keys.filter((key) => GOOGLE_API_KEY_PATTERN.test(key));
  const otherKeys = keys.filter((key) => !GOOGLE_API_KEY_PATTERN.test(key));
  return googleKeys.length > 0 ? [...googleKeys, ...otherKeys] : keys;
}

function getErrorStatus(error) {
  if (typeof error?.status === 'number') return error.status;
  if (typeof error?.statusCode === 'number') return error.statusCode;
  if (typeof error?.code === 'number') return error.code;
  return 0;
}

export function isAuthKeyError(error) {
  const status = getErrorStatus(error);
  if (status === 401 || status === 403) return true;
  const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return (
    msg.includes('api_key_invalid')
    || msg.includes('api key not valid')
    || msg.includes('access_token_type_unsupported')
    || msg.includes('unauthenticated')
    || msg.includes('permission_denied')
  );
}

export function isQuotaExhaustedError(error) {
  const status = getErrorStatus(error);
  if (status === 429) return true;
  const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return (
    msg.includes('quota')
    || msg.includes('resource_exhausted')
    || msg.includes('resource has been exhausted')
    || msg.includes('rate limit')
    || msg.includes('too many requests')
    || msg.includes('exceeded')
    || msg.includes('limit: 20')
    || msg.includes('429')
  );
}

export function isKeyRotationEligibleError(error) {
  return isAuthKeyError(error) || isQuotaExhaustedError(error);
}

function getModelExhaustedMap(model = 'gemini-4-hydrogen', now = Date.now()) {
  const targetModel = model || 'gemini-4-hydrogen';
  let map = QUOTA_EXHAUSTED_KEYS_BY_MODEL.get(targetModel);
  if (!map) {
    map = new Map();
    QUOTA_EXHAUSTED_KEYS_BY_MODEL.set(targetModel, map);
  }
  for (const [key, exhaustedAt] of map.entries()) {
    if (isPacificCycleExpired(exhaustedAt, '', now)) {
      map.delete(key);
    }
  }
  return map;
}

export function markGeminiKeyQuotaExhausted(apiKey, model = 'gemini-4-hydrogen', now = Date.now()) {
  if (typeof apiKey !== 'string' || !apiKey) return;
  const map = getModelExhaustedMap(model, now);
  if (!map.has(apiKey)) {
    map.set(apiKey, now);
  }
}

export function clearGeminiKeyFailureState(apiKey, model = 'gemini-4-hydrogen') {
  if (typeof apiKey !== 'string' || !apiKey) return;
  INVALID_AUTH_KEYS.delete(apiKey);
  GLOBAL_AUTH_COOLDOWN.delete(apiKey);
  MODEL_QUOTA_COOLDOWN.delete(getCooldownMapKey(apiKey, model));
  const map = QUOTA_EXHAUSTED_KEYS_BY_MODEL.get(model || 'gemini-4-hydrogen');
  if (map) map.delete(apiKey);
}

export function clearModelQuotaExhausted(model = 'gemini-4-hydrogen') {
  const targetModel = model || 'gemini-4-hydrogen';
  QUOTA_EXHAUSTED_KEYS_BY_MODEL.delete(targetModel);
  const suffix = `::${targetModel}`;
  for (const key of MODEL_QUOTA_COOLDOWN.keys()) {
    if (key.endsWith(suffix)) {
      MODEL_QUOTA_COOLDOWN.delete(key);
    }
  }
}

export function markGeminiKeyCooldown(apiKey, error, model = '', now = Date.now()) {
  if (typeof apiKey !== 'string' || !apiKey) return;
  if (isAuthKeyError(error)) {
    INVALID_AUTH_KEYS.add(apiKey);
    GLOBAL_AUTH_COOLDOWN.set(apiKey, now + AUTH_COOLDOWN_MS);
    return;
  }
  if (isQuotaExhaustedError(error)) {
    markGeminiKeyQuotaExhausted(apiKey, model || 'gemini-4-hydrogen', now);
  }
  const key = getCooldownMapKey(apiKey, model);
  MODEL_QUOTA_COOLDOWN.set(key, now + QUOTA_COOLDOWN_MS);
}

export function getServerQuotaSnapshot(
  env,
  model = 'gemini-4-hydrogen',
  now = Date.now(),
  quotaPerKey = DAILY_QUOTA_PER_KEY
) {
  const safeQuotaPerKey = typeof quotaPerKey === 'number' && Number.isFinite(quotaPerKey) && quotaPerKey > 0
    ? Math.floor(quotaPerKey)
    : DAILY_QUOTA_PER_KEY;
  const allKeys = getGeminiApiKeys(env);
  const validKeys = allKeys.filter((key) => !INVALID_AUTH_KEYS.has(key));
  const exhaustedMap = getModelExhaustedMap(model, now);
  const exhaustedKeyCount = validKeys.filter((key) => exhaustedMap.has(key)).length;
  const validKeyCount = validKeys.length;
  const healthyKeyCount = Math.max(0, validKeyCount - exhaustedKeyCount);
  const totalCapacity = validKeyCount * safeQuotaPerKey;
  const maxRemainingFromHealthyKeys = healthyKeyCount * safeQuotaPerKey;

  return {
    validKeyCount,
    configuredKeyCount: allKeys.length,
    exhaustedKeyCount,
    healthyKeyCount,
    quotaPerKey: safeQuotaPerKey,
    totalCapacity,
    maxRemainingFromHealthyKeys,
    cycleDurationMs: QUOTA_CYCLE_MS,
    cycleStartedAt: getPacificCycleStartMs(now),
    nextResetAt: getNextPacificResetMs(now),
    ptDateKey: getPacificDateKey(now)
  };
}

export function getDualServerQuotaSnapshot(env, now = Date.now()) {
  const plusPlus = getServerQuotaSnapshot(env, 'gemini-4-hydrogen', now, DAILY_QUOTA_PER_KEY);
  const plus = getServerQuotaSnapshot(env, 'gemini-3.5-flash-lite', now, PLUS_QUOTA_PER_KEY);
  return { plusPlus, plus };
}

export function isKnownInvalidAuthKey(apiKey) {
  return typeof apiKey === 'string' && INVALID_AUTH_KEYS.has(apiKey);
}

export function isAuthKeyInCooldown(apiKey, now = Date.now()) {
  const authUntil = GLOBAL_AUTH_COOLDOWN.get(apiKey) || 0;
  if (authUntil > now) return true;
  if (authUntil > 0) GLOBAL_AUTH_COOLDOWN.delete(apiKey);
  return false;
}

export function isKeyInCooldown(apiKey, model = '', now = Date.now()) {
  if (isAuthKeyInCooldown(apiKey, now)) return true;

  const modelKey = getCooldownMapKey(apiKey, model);
  const quotaUntil = MODEL_QUOTA_COOLDOWN.get(modelKey) || 0;
  if (quotaUntil > now) return true;
  if (quotaUntil > 0) MODEL_QUOTA_COOLDOWN.delete(modelKey);

  return false;
}

export function rotateGeminiKeys(env, model = '', now = Date.now()) {
  const allKeys = getGeminiApiKeys(env);
  if (allKeys.length <= 1) return allKeys;

  const healthyKeys = allKeys.filter((key) => !isKeyInCooldown(key, model, now));
  const quotaOnlyCooled = allKeys
    .filter((key) => !isAuthKeyInCooldown(key, now) && isKeyInCooldown(key, model, now))
    .sort((a, b) => (MODEL_QUOTA_COOLDOWN.get(getCooldownMapKey(a, model)) || 0) - (MODEL_QUOTA_COOLDOWN.get(getCooldownMapKey(b, model)) || 0));
  const authCooled = allKeys
    .filter((key) => isAuthKeyInCooldown(key, now))
    .sort((a, b) => (GLOBAL_AUTH_COOLDOWN.get(a) || 0) - (GLOBAL_AUTH_COOLDOWN.get(b) || 0));

  const primaryPool = healthyKeys.length > 0 ? healthyKeys : (quotaOnlyCooled.length > 0 ? quotaOnlyCooled : authCooled);
  const start = rotationCursor % primaryPool.length;
  rotationCursor = (start + 1) % primaryPool.length;
  const rotatedPrimary = [...primaryPool.slice(start), ...primaryPool.slice(0, start)];

  const trailingPool = healthyKeys.length > 0
    ? [...quotaOnlyCooled, ...authCooled]
    : (quotaOnlyCooled.length > 0 ? authCooled : []);

  return [...rotatedPrimary, ...trailingPool];
}

export function createGeminiClient(apiKey) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

export function sanitizeSecretFromErrorMessage(message) {
  if (typeof message !== 'string') return '';
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/\bGEMINI_(?:API_)?KEYS?(?:_\d+|_[A-Z0-9_]+)?\b/g, '[REDACTED_ENV]');
}

export async function runWithRotatedGeminiKeys(env, taskFn, { model = '', now = Date.now() } = {}) {
  const allKeys = getGeminiApiKeys(env);
  if (allKeys.length === 0) {
    throw new Error('خدمة الذكاء الاصطناعي غير مهيأة حالياً على الخادم.');
  }

  const rotatedKeys = rotateGeminiKeys(env, model, now);
  const keysToTry = rotatedKeys;

  let lastError;
  for (let index = 0; index < keysToTry.length; index += 1) {
    const apiKey = keysToTry[index];
    try {
      const result = await taskFn({
        apiKey,
        keyIndex: index,
        totalKeys: keysToTry.length
      });
      clearGeminiKeyFailureState(apiKey, model);
      return result;
    } catch (error) {
      lastError = error;
      const status = getErrorStatus(error);
      const canRotate = isKeyRotationEligibleError(error) || status === 503 || status === 500 || status === 502 || status === 504;
      if (isKeyRotationEligibleError(error)) {
        markGeminiKeyCooldown(apiKey, error, model, Date.now());
      }
      if (!canRotate && index === keysToTry.length - 1) {
        throw error;
      }
      if (index === keysToTry.length - 1) {
        throw error;
      }
    }
  }

  throw lastError || new Error('تعذر الاتصال بنموذج Gemini عبر المفاتيح المتاحة.');
}
