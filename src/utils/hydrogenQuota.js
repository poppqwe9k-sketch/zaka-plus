import {
  GEMINI_FALLBACK_LITE_MODEL_ID,
  GEMINI_HYDROGEN_MODEL_ID
} from '../shared/modelTiers.js';

export const DAILY_HYDROGEN_LIMIT = 3;
export const MODEL_HYDROGEN = GEMINI_HYDROGEN_MODEL_ID;
export const MODEL_FLASH_LITE = GEMINI_FALLBACK_LITE_MODEL_ID;

export function getTodayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `zaka_plus_hydrogen_${year}-${month}-${day}`;
}

export function getHydrogenUsedToday(now = new Date()) {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(getTodayKey(now));
    const count = Number(raw || 0);
    return Number.isFinite(count) && count >= 0
      ? Math.min(Math.floor(count), DAILY_HYDROGEN_LIMIT)
      : 0;
  } catch {
    return 0;
  }
}

export function getHydrogenRemainingToday(now = new Date()) {
  return Math.max(0, DAILY_HYDROGEN_LIMIT - getHydrogenUsedToday(now));
}

export function incrementHydrogenUsedToday(now = new Date()) {
  const next = Math.min(DAILY_HYDROGEN_LIMIT, getHydrogenUsedToday(now) + 1);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(getTodayKey(now), String(next));
    }
  } catch {
    // تجاهل في حال تعذر التخزين المحلي
  }
  return next;
}

export function exhaustHydrogenQuotaToday(now = new Date()) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(getTodayKey(now), String(DAILY_HYDROGEN_LIMIT));
    }
  } catch {
    // تجاهل في حال تعذر التخزين المحلي
  }
  return DAILY_HYDROGEN_LIMIT;
}

export function reconcileCreditsWithHydrogenQuota(
  creditsState,
  dailyLimit = DAILY_HYDROGEN_LIMIT,
  remainingToday = getHydrogenRemainingToday()
) {
  if (!creditsState || typeof creditsState !== 'object') {
    return creditsState;
  }
  const safeLimit = Number(dailyLimit) || DAILY_HYDROGEN_LIMIT;
  if (safeLimit > DAILY_HYDROGEN_LIMIT) {
    return creditsState;
  }
  const safeRemainingToday = Math.max(0, Math.min(DAILY_HYDROGEN_LIMIT, Math.floor(Number(remainingToday) || 0)));
  const currentRemaining = Math.max(0, Math.floor(Number(creditsState.remaining) || 0));
  const cappedRemaining = Math.min(currentRemaining, safeRemainingToday);
  if (cappedRemaining === creditsState.remaining) {
    return creditsState;
  }
  return {
    ...creditsState,
    remaining: cappedRemaining
  };
}
