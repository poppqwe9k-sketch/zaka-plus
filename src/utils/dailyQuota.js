export const DAILY_QUOTA_PER_KEY = 20;
export const PLUS_QUOTA_PER_KEY = 1000;
export const QUOTA_CYCLE_MS = 24 * 60 * 60 * 1000;
export const QUOTA_STORAGE_KEY = 'zaka-plus-daily-quota-v1';
export const PLUS_QUOTA_STORAGE_KEY = 'zaka-plus-lite-daily-quota-v1';

function toNonNegInt(value, fallback = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function toPosInt(value, fallback = DAILY_QUOTA_PER_KEY) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

export function isCycleExpired(cycleStartedAt, now = Date.now()) {
  if (typeof cycleStartedAt !== 'number' || !Number.isFinite(cycleStartedAt) || cycleStartedAt <= 0) {
    return true;
  }
  if (now < cycleStartedAt) {
    return true;
  }
  return now - cycleStartedAt >= QUOTA_CYCLE_MS;
}

export function createFreshQuotaState({
  validKeyCount = 0,
  exhaustedKeyCount = 0,
  quotaPerKey = DAILY_QUOTA_PER_KEY,
  now = Date.now()
} = {}) {
  const safeKeyCount = toNonNegInt(validKeyCount, 0);
  const safeQuotaPerKey = toPosInt(quotaPerKey, DAILY_QUOTA_PER_KEY);
  const safeExhausted = Math.min(safeKeyCount, toNonNegInt(exhaustedKeyCount, 0));
  const totalCapacity = safeKeyCount * safeQuotaPerKey;
  const maxRemaining = Math.max(0, (safeKeyCount - safeExhausted) * safeQuotaPerKey);

  return {
    cycleStartedAt: now,
    resetAt: now + QUOTA_CYCLE_MS,
    validKeyCount: safeKeyCount,
    quotaPerKey: safeQuotaPerKey,
    exhaustedKeyCount: safeExhausted,
    totalCapacity,
    remaining: maxRemaining,
    usedCount: Math.max(0, totalCapacity - maxRemaining),
    updatedAt: now
  };
}

export function reconcileQuotaState(savedState, serverMeta = {}, now = Date.now()) {
  const hasServerMeta = Boolean(serverMeta && typeof serverMeta === 'object');
  const quotaPerKey = toPosInt(
    hasServerMeta ? serverMeta.quotaPerKey : undefined,
    toPosInt(savedState?.quotaPerKey, DAILY_QUOTA_PER_KEY)
  );
  const hasServerKeyCount = hasServerMeta && typeof serverMeta.validKeyCount === 'number' && Number.isFinite(serverMeta.validKeyCount);
  const validKeyCount = hasServerKeyCount
    ? toNonNegInt(serverMeta.validKeyCount, 0)
    : toNonNegInt(savedState?.validKeyCount, 0);
  const hasServerExhausted = hasServerMeta && typeof serverMeta.exhaustedKeyCount === 'number' && Number.isFinite(serverMeta.exhaustedKeyCount);
  const expired = !savedState || typeof savedState !== 'object' || isCycleExpired(savedState.cycleStartedAt, now);

  const exhaustedKeyCount = Math.min(
    validKeyCount,
    hasServerExhausted
      ? toNonNegInt(serverMeta.exhaustedKeyCount, 0)
      : (expired ? 0 : toNonNegInt(savedState?.exhaustedKeyCount, 0))
  );

  if (expired) {
    return createFreshQuotaState({
      validKeyCount,
      exhaustedKeyCount,
      quotaPerKey,
      now
    });
  }

  const totalCapacity = validKeyCount * quotaPerKey;
  const maxRemainingFromHealthy = Math.max(0, (validKeyCount - exhaustedKeyCount) * quotaPerKey);
  const priorUsed = toNonNegInt(savedState.usedCount, 0);
  const uncappedRemaining = Math.max(0, totalCapacity - priorUsed);
  const remaining = Math.min(uncappedRemaining, maxRemainingFromHealthy);
  const usedCount = Math.max(0, totalCapacity - remaining);

  return {
    cycleStartedAt: savedState.cycleStartedAt,
    resetAt: savedState.cycleStartedAt + QUOTA_CYCLE_MS,
    validKeyCount,
    quotaPerKey,
    exhaustedKeyCount,
    totalCapacity,
    remaining,
    usedCount,
    updatedAt: now
  };
}

export function applyMessageSendQuota(currentState, quotaMeta = {}, now = Date.now()) {
  const reconciled = reconcileQuotaState(currentState, quotaMeta, now);
  if (!quotaMeta || quotaMeta.reachedModel !== true) {
    return reconciled;
  }

  if (quotaMeta.succeeded === true) {
    const nextRemaining = Math.max(0, reconciled.remaining - 1);
    return {
      ...reconciled,
      remaining: nextRemaining,
      usedCount: Math.max(0, reconciled.totalCapacity - nextRemaining),
      updatedAt: now
    };
  }

  return {
    ...reconciled,
    updatedAt: now
  };
}

export function loadDailyQuotaState(
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  storageKey = QUOTA_STORAGE_KEY
) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDailyQuotaState(
  state,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  storageKey = QUOTA_STORAGE_KEY
) {
  if (!storage || typeof storage.setItem !== 'function' || !state) return;
  try {
    storage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors cleanly.
  }
}

export function formatDailyQuotaText(remaining, lang = 'ar') {
  const safeRemaining = toNonNegInt(remaining, 0);
  if (lang === 'ar') {
    return `السعة الكلية: ${safeRemaining} رسالة متبقية (تتجدد كل 24 ساعة)`;
  }
  if (lang === 'fa') {
    return `ظرفیت کل: ${safeRemaining} پیام باقی مانده (تمدید هر ۲۴ ساعت)`;
  }
  if (lang === 'ur') {
    return `کل گنجائش: ${safeRemaining} پیغامات باقی ہیں (ہر 24 گھنٹے بعد تجدید)`;
  }
  if (lang === 'fr') {
    return `Capacité globale : ${safeRemaining} messages restants (24 h)`;
  }
  if (lang === 'es') {
    return `Capacidad global: ${safeRemaining} mensajes restantes (24 h)`;
  }
  if (lang === 'de') {
    return `Gesamtkapazität: ${safeRemaining} Nachrichten übrig (24 Std.)`;
  }
  if (lang === 'tr') {
    return `Toplam kapasite: ${safeRemaining} mesaj hakkı kaldı (24 saat)`;
  }
  return safeRemaining === 1
    ? 'Total capacity: 1 message remaining (resets every 24 hours)'
    : `Total capacity: ${safeRemaining} messages remaining (resets every 24 hours)`;
}
