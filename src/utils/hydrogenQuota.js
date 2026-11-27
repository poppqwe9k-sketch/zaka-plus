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

export function shouldDeductHydrogenAttempt({
  responseOk = true,
  ok = true,
  status = 200,
  replyText = '',
  usedFallback = false,
  usedModel = ''
} = {}) {
  if (responseOk === false || ok === false) {
    return false;
  }
  const numericStatus = Number(status);
  if (Number.isFinite(numericStatus) && numericStatus >= 400) {
    return false;
  }
  if (typeof replyText !== 'string' || !replyText.trim()) {
    return false;
  }
  if (usedFallback) {
    return false;
  }
  if (usedModel && usedModel !== MODEL_HYDROGEN) {
    return false;
  }
  return true;
}

export function getLocalCalendarDateString(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function doesHydrogenQuotaNeedReset(profile, todayDate = getLocalCalendarDateString()) {
  if (!profile || typeof profile !== 'object') return false;
  const storedDate = typeof profile.hydrogenQuotaDate === 'string'
    ? profile.hydrogenQuotaDate.trim()
    : '';
  const storedUsed = Number(profile.hydrogenUsedCount);
  return !storedDate || storedDate !== todayDate || !Number.isFinite(storedUsed) || storedUsed < 0;
}

export function getProfileHydrogenQuotaState(
  profile,
  todayDate = getLocalCalendarDateString(),
  dailyLimit = DAILY_HYDROGEN_LIMIT
) {
  const safeLimit = Math.max(1, Math.floor(Number(dailyLimit || profile?.dailyLimit) || DAILY_HYDROGEN_LIMIT));
  if (!profile || typeof profile !== 'object') {
    return {
      used: 0,
      remaining: safeLimit,
      limit: safeLimit,
      quotaDate: todayDate,
      needsReset: false
    };
  }

  const storedQuotaDate = typeof profile.hydrogenQuotaDate === 'string'
    ? profile.hydrogenQuotaDate.trim()
    : '';
  const storedResetDate = typeof profile.lastResetDate === 'string'
    ? profile.lastResetDate.trim()
    : '';
  const storedUsedNum = Number(profile.hydrogenUsedCount);
  const hasStoredQuotaDate = Boolean(storedQuotaDate);
  const hasStoredUsed = Number.isFinite(storedUsedNum) && storedUsedNum >= 0;

  let used = 0;
  let needsReset = false;

  if (hasStoredQuotaDate) {
    if (storedQuotaDate === todayDate) {
      used = hasStoredUsed ? Math.min(safeLimit, Math.floor(storedUsedNum)) : 0;
      needsReset = !hasStoredUsed;
    } else {
      used = 0;
      needsReset = true;
    }
  } else {
    needsReset = true;
    if (storedResetDate === todayDate && Number.isFinite(Number(profile.remainingCredits))) {
      const safeRemaining = Math.max(0, Math.min(safeLimit, Math.floor(Number(profile.remainingCredits))));
      used = Math.max(0, safeLimit - safeRemaining);
    } else {
      used = 0;
    }
  }

  const remaining = Math.max(0, safeLimit - used);
  return {
    used,
    remaining,
    limit: safeLimit,
    quotaDate: todayDate,
    needsReset
  };
}
