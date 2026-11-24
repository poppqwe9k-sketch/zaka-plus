export const CREDITS_STORAGE_KEY = 'plus-ai-credits-v2';
export const DAILY_FREE_CREDITS = 3;
export const CREDITS_CYCLE_MS = 24 * 60 * 60 * 1000;

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isCreditsCycleExpired(rawState, todayKey = getLocalDateKey(), now = Date.now()) {
  if (!rawState || typeof rawState !== 'object') {
    return true;
  }
  const startedAt = Number(rawState.cycleStartedAt);
  if (Number.isFinite(startedAt) && startedAt > 0) {
    if (now < startedAt) return true;
    return now - startedAt >= CREDITS_CYCLE_MS;
  }
  return rawState.lastResetDate !== todayKey;
}

export function normalizeCreditsState(
  rawState,
  todayKey = getLocalDateKey(),
  now = Date.now(),
  dailyLimit = DAILY_FREE_CREDITS
) {
  const safeLimit = Math.max(1, Math.floor(Number(dailyLimit) || DAILY_FREE_CREDITS));
  const safeTotalUsed = Math.max(0, Math.floor(Number(rawState?.totalUsed) || 0));
  const parsedRemaining = Number(rawState?.remaining);
  const validRemaining = Number.isFinite(parsedRemaining)
    ? Math.max(0, Math.floor(parsedRemaining))
    : safeLimit;

  if (isCreditsCycleExpired(rawState, todayKey, now)) {
    const hasPriorRecord = Boolean(
      rawState && typeof rawState === 'object' && (rawState.lastResetDate || rawState.cycleStartedAt)
    );
    return {
      remaining: hasPriorRecord ? Math.max(safeLimit, validRemaining) : safeLimit,
      dailyLimit: safeLimit,
      lastResetDate: todayKey,
      cycleStartedAt: now,
      resetAt: now + CREDITS_CYCLE_MS,
      totalUsed: safeTotalUsed
    };
  }

  const startedAt = Number(rawState.cycleStartedAt);
  const cycleStartedAt = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : now;

  return {
    remaining: validRemaining,
    dailyLimit: safeLimit,
    lastResetDate: rawState.lastResetDate || todayKey,
    cycleStartedAt,
    resetAt: cycleStartedAt + CREDITS_CYCLE_MS,
    totalUsed: safeTotalUsed
  };
}

export function getUserCreditsStorageKey(uid = '') {
  return uid ? `${CREDITS_STORAGE_KEY}:${uid}` : CREDITS_STORAGE_KEY;
}

export function loadCreditsState(
  todayKey = getLocalDateKey(),
  now = Date.now(),
  dailyLimit = DAILY_FREE_CREDITS,
  storageKey = CREDITS_STORAGE_KEY
) {
  try {
    if (typeof localStorage === 'undefined') {
      return normalizeCreditsState(null, todayKey, now, dailyLimit);
    }
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      const initial = normalizeCreditsState(null, todayKey, now, dailyLimit);
      saveCreditsState(initial, storageKey);
      return initial;
    }
    const parsed = JSON.parse(raw);
    const normalized = normalizeCreditsState(parsed, todayKey, now, dailyLimit);
    if (
      normalized.lastResetDate !== parsed?.lastResetDate
      || normalized.cycleStartedAt !== parsed?.cycleStartedAt
      || normalized.remaining !== parsed?.remaining
    ) {
      saveCreditsState(normalized, storageKey);
    }
    return normalized;
  } catch {
    return normalizeCreditsState(null, todayKey, now, dailyLimit);
  }
}

export function saveCreditsState(state, storageKey = CREDITS_STORAGE_KEY) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors gracefully.
  }
}

export function isCreditRequiredAction({ wantsImage = false, selectedModel = 'plus' } = {}) {
  return Boolean(wantsImage) || selectedModel === 'plus-max';
}

export function consumeOneCredit(
  state,
  todayKey = getLocalDateKey(),
  now = Date.now(),
  dailyLimit = DAILY_FREE_CREDITS
) {
  const current = normalizeCreditsState(state, todayKey, now, dailyLimit);
  return {
    ...current,
    remaining: Math.max(0, current.remaining - 1),
    totalUsed: current.totalUsed + 1
  };
}
