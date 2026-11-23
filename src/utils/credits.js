export const CREDITS_STORAGE_KEY = 'zaka-plus-credits-v1';
export const DAILY_FREE_CREDITS = 5;
export const REWARD_CREDITS_AMOUNT = 5;

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeCreditsState(rawState, todayKey = getLocalDateKey()) {
  const safeAdsWatched = Math.max(0, Math.floor(Number(rawState?.adsWatched) || 0));
  const safeTotalUsed = Math.max(0, Math.floor(Number(rawState?.totalUsed) || 0));
  const parsedRemaining = Number(rawState?.remaining);
  const validRemaining = Number.isFinite(parsedRemaining)
    ? Math.max(0, Math.floor(parsedRemaining))
    : DAILY_FREE_CREDITS;

  if (!rawState || typeof rawState !== 'object' || rawState.lastResetDate !== todayKey) {
    return {
      remaining: Math.max(DAILY_FREE_CREDITS, rawState?.lastResetDate ? validRemaining : DAILY_FREE_CREDITS),
      lastResetDate: todayKey,
      adsWatched: safeAdsWatched,
      totalUsed: safeTotalUsed
    };
  }

  return {
    remaining: validRemaining,
    lastResetDate: todayKey,
    adsWatched: safeAdsWatched,
    totalUsed: safeTotalUsed
  };
}

export function loadCreditsState(todayKey = getLocalDateKey()) {
  try {
    if (typeof localStorage === 'undefined') {
      return normalizeCreditsState(null, todayKey);
    }
    const raw = localStorage.getItem(CREDITS_STORAGE_KEY);
    if (!raw) {
      const initial = normalizeCreditsState(null, todayKey);
      saveCreditsState(initial);
      return initial;
    }
    const parsed = JSON.parse(raw);
    const normalized = normalizeCreditsState(parsed, todayKey);
    if (normalized.lastResetDate !== parsed?.lastResetDate) {
      saveCreditsState(normalized);
    }
    return normalized;
  } catch {
    return normalizeCreditsState(null, todayKey);
  }
}

export function saveCreditsState(state) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CREDITS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors gracefully.
  }
}

export function isCreditRequiredAction({ wantsImage = false, selectedModel = 'plus' } = {}) {
  return Boolean(wantsImage) || selectedModel === 'plus-max';
}

export function consumeOneCredit(state, todayKey = getLocalDateKey()) {
  const current = normalizeCreditsState(state, todayKey);
  return {
    ...current,
    remaining: Math.max(0, current.remaining - 1),
    totalUsed: current.totalUsed + 1
  };
}

export function grantRewardCredits(state, amount = REWARD_CREDITS_AMOUNT, todayKey = getLocalDateKey()) {
  const current = normalizeCreditsState(state, todayKey);
  const safeAmount = Math.max(1, Math.floor(Number(amount) || REWARD_CREDITS_AMOUNT));
  return {
    ...current,
    remaining: current.remaining + safeAmount,
    adsWatched: current.adsWatched + 1
  };
}
