import { CREDITS_CYCLE_MS, DAILY_FREE_CREDITS, getLocalDateKey } from './credits.js';
import {
  getNextPacificResetMs,
  getPacificDateKey,
  isPacificCycleExpired
} from './pacificTime.js';

export const ADMIN_EMAIL = 'poppqwe9k@gmail.com';
export const GLOBAL_ADMIN_CAPACITY_TARGET = 200;
export const PLUS_PLUS_ADMIN_CAPACITY_TARGET = 200;
export const PLUS_ADMIN_CAPACITY_TARGET = 10000;

export const USER_PLANS = [
  { id: 'free', defaultDailyLimit: DAILY_FREE_CREDITS },
  { id: 'pro', defaultDailyLimit: 25 },
  { id: 'vip', defaultDailyLimit: 100 }
];

export function isAdminUser(user) {
  if (!user || typeof user.email !== 'string') return false;
  return user.email.trim().toLowerCase() === ADMIN_EMAIL && user.emailVerified === true;
}

export function isAdminEmailUnverified(user) {
  if (!user || typeof user.email !== 'string') return false;
  return user.email.trim().toLowerCase() === ADMIN_EMAIL && user.emailVerified !== true;
}

export function sanitizeDisplayName(rawName, email = '') {
  const fromName = typeof rawName === 'string' ? rawName.trim() : '';
  if (fromName) return fromName.slice(0, 100);
  const emailPrefix = typeof email === 'string' && email.includes('@')
    ? email.split('@')[0].trim()
    : '';
  return (emailPrefix || 'مستخدم Plus AI').slice(0, 100);
}

export function sanitizeEmail(rawEmail) {
  if (typeof rawEmail !== 'string') return '';
  return rawEmail.trim().slice(0, 254);
}

export function normalizePlan(plan) {
  return plan === 'pro' || plan === 'vip' ? plan : 'free';
}

export function clampDailyLimit(limit, fallback = DAILY_FREE_CREDITS) {
  const num = Number(limit);
  if (!Number.isFinite(num) || num < 1) return fallback;
  return Math.min(10000, Math.floor(num));
}

export function clampCredits(value, fallback = DAILY_FREE_CREDITS) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.min(100000, Math.floor(num));
}

export function buildInitialUserProfile({
  uid,
  email,
  displayName,
  now = Date.now(),
  todayKey = getLocalDateKey(new Date(now))
}) {
  const safeEmail = sanitizeEmail(email);
  return {
    uid: String(uid || '').slice(0, 128),
    email: safeEmail || 'user@plus-ai.local',
    displayName: sanitizeDisplayName(displayName, safeEmail),
    plan: 'free',
    dailyLimit: DAILY_FREE_CREDITS,
    remainingCredits: DAILY_FREE_CREDITS,
    cycleStartedAt: Math.max(0, Math.floor(now)),
    lastResetDate: String(todayKey || getLocalDateKey()).slice(0, 20),
    totalUsed: 0,
    visitsCount: 1
  };
}

export function computeAdminCapacitySummary(
  dailyQuota,
  targetCapacity = GLOBAL_ADMIN_CAPACITY_TARGET
) {
  const safeTarget = Math.max(1, Math.floor(Number(targetCapacity) || GLOBAL_ADMIN_CAPACITY_TARGET));
  if (!dailyQuota || typeof dailyQuota !== 'object') {
    return {
      targetCapacity: safeTarget,
      remaining: safeTarget,
      used: 0,
      percentRemaining: 100,
      validKeyCount: 0,
      actualCapacity: safeTarget
    };
  }

  const validKeyCount = Math.max(0, Math.floor(Number(dailyQuota.validKeyCount) || 0));
  const actualCapacity = Math.max(0, Math.floor(Number(dailyQuota.totalCapacity) || 0));

  let remaining = 0;
  if (validKeyCount > 0) {
    const rawRemaining = Math.max(0, Math.floor(Number(dailyQuota.remaining) || 0));
    remaining = Math.min(safeTarget, rawRemaining);
  }

  const percentRemaining = safeTarget > 0
    ? Math.max(0, Math.min(100, Math.round((remaining / safeTarget) * 100)))
    : 0;

  return {
    targetCapacity: safeTarget,
    remaining,
    used: Math.max(0, safeTarget - remaining),
    percentRemaining,
    validKeyCount,
    actualCapacity
  };
}

function summarizeSingleModelCapacity(
  state,
  targetCapacity,
  dbUsed = null,
  fallbackValidKeys = 0,
  dbChars = null,
  now = Date.now()
) {
  const stateExpired = Boolean(
    state
    && typeof state === 'object'
    && state.cycleStartedAt
    && isPacificCycleExpired(state.cycleStartedAt, state.ptDateKey || '', now)
  );
  const effectiveState = state && typeof state === 'object' && stateExpired
    ? {
        ...state,
        exhaustedKeyCount: 0,
        usedCount: 0,
        remaining: Math.max(0, Number(state.totalCapacity) || 0),
        charsUsed: 0
      }
    : state;

  const base = computeAdminCapacitySummary(effectiveState, targetCapacity);
  const effectiveValidKeys = effectiveState && typeof effectiveState === 'object'
    ? base.validKeyCount
    : Math.max(0, Math.floor(Number(fallbackValidKeys) || 0));

  let remaining = base.remaining;
  if (dbUsed !== null) {
    if (effectiveState && typeof effectiveState === 'object' && base.validKeyCount === 0) {
      remaining = 0;
    } else {
      const dbRemaining = Math.max(0, targetCapacity - dbUsed);
      const hasExhaustedServerKeys = Boolean(
        effectiveState && typeof effectiveState === 'object' && Number(effectiveState.exhaustedKeyCount) > 0
      );
      remaining = hasExhaustedServerKeys ? Math.min(dbRemaining, base.remaining) : dbRemaining;
    }
  }

  const used = Math.max(0, targetCapacity - remaining);
  const percentRemaining = targetCapacity > 0
    ? Math.max(0, Math.min(100, Math.round((remaining / targetCapacity) * 100)))
    : 0;
  const localChars = Math.max(0, Math.floor(Number(effectiveState?.charsUsed) || 0));
  const charsUsed = dbChars !== null
    ? Math.max(0, Math.floor(Number(dbChars) || 0))
    : localChars;

  return {
    targetCapacity,
    remaining,
    used,
    charsUsed,
    percentRemaining,
    validKeyCount: effectiveValidKeys,
    actualCapacity: base.actualCapacity
  };
}

export function computeDualModelCapacitySummary({
  dailyQuota = null,
  plusDailyQuota = null,
  quotaAnalytics = null,
  now = Date.now()
} = {}) {
  const cycleStartedAt = Number(quotaAnalytics?.cycleStartedAt);
  const hasDbDoc = Boolean(
    quotaAnalytics
    && typeof quotaAnalytics === 'object'
    && Number.isFinite(cycleStartedAt)
    && cycleStartedAt > 0
  );
  const dbExpired = hasDbDoc
    ? isPacificCycleExpired(cycleStartedAt, quotaAnalytics.ptDateKey || '', now)
    : false;
  const dbPlusPlusUsed = hasDbDoc
    ? (dbExpired ? 0 : Math.max(0, Math.floor(Number(quotaAnalytics.plusPlusUsed) || 0)))
    : null;
  const dbPlusUsed = hasDbDoc
    ? (dbExpired ? 0 : Math.max(0, Math.floor(Number(quotaAnalytics.plusUsed) || 0)))
    : null;
  const dbPlusPlusChars = hasDbDoc
    ? (dbExpired ? 0 : Math.max(0, Math.floor(Number(quotaAnalytics.plusPlusChars) || 0)))
    : null;
  const dbPlusChars = hasDbDoc
    ? (dbExpired ? 0 : Math.max(0, Math.floor(Number(quotaAnalytics.plusChars) || 0)))
    : null;

  const plusPlus = summarizeSingleModelCapacity(
    dailyQuota,
    PLUS_PLUS_ADMIN_CAPACITY_TARGET,
    dbPlusPlusUsed,
    0,
    dbPlusPlusChars,
    now
  );
  const plus = summarizeSingleModelCapacity(
    plusDailyQuota,
    PLUS_ADMIN_CAPACITY_TARGET,
    dbPlusUsed,
    plusPlus.validKeyCount,
    dbPlusChars,
    now
  );

  return {
    plusPlus,
    plus,
    ptDateKey: getPacificDateKey(now),
    nextResetAt: getNextPacificResetMs(now)
  };
}

export function isUserProfileCycleExpired(profile, now = Date.now()) {
  const startedAt = Number(profile?.cycleStartedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return true;
  if (now < startedAt) return true;
  return now - startedAt >= CREDITS_CYCLE_MS;
}

export function isPaidPlanUser(user) {
  const plan = normalizePlan(user?.plan);
  return plan === 'pro' || plan === 'vip';
}

export function filterAndSortUsers(users = [], query = '') {
  const list = Array.isArray(users) ? [...users] : [];
  const trimmed = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const filtered = trimmed
    ? list.filter((u) => {
        const name = String(u?.displayName || '').toLowerCase();
        const email = String(u?.email || '').toLowerCase();
        const plan = String(u?.plan || '').toLowerCase();
        return name.includes(trimmed) || email.includes(trimmed) || plan.includes(trimmed);
      })
    : list;

  return filtered.sort((a, b) => {
    const aTime = typeof a?.lastActiveAt?.toMillis === 'function'
      ? a.lastActiveAt.toMillis()
      : (Number(a?.cycleStartedAt) || 0);
    const bTime = typeof b?.lastActiveAt?.toMillis === 'function'
      ? b.lastActiveAt.toMillis()
      : (Number(b?.cycleStartedAt) || 0);
    return bTime - aTime;
  });
}

export function filterUsersDirectory(users = [], { query = '', paidOnly = false } = {}) {
  const base = Array.isArray(users) ? users : [];
  const scoped = paidOnly ? base.filter((u) => isPaidPlanUser(u)) : base;
  return filterAndSortUsers(scoped, query);
}

export function validateAuthFormInput({ mode = 'login', email = '', password = '' } = {}) {
  const cleanEmail = sanitizeEmail(email);
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, errorKey: 'authErrInvalidEmail', email: cleanEmail };
  }
  if (mode === 'forgot') {
    return { ok: true, email: cleanEmail };
  }
  const safePassword = typeof password === 'string' ? password : '';
  if (safePassword.length < 6) {
    return { ok: false, errorKey: 'authErrWeakPassword', email: cleanEmail };
  }
  return { ok: true, email: cleanEmail };
}

export function shouldFallbackToRedirectSignIn(error, win = typeof window !== 'undefined' ? window : null) {
  const code = error?.code || '';
  if (code !== 'auth/popup-blocked' && code !== 'auth/operation-not-supported-in-this-environment') {
    return false;
  }
  if (!win) return false;
  try {
    return win.self === win.top;
  } catch {
    return false;
  }
}

export function mapFirebaseAuthError(error, t = {}, context = {}) {
  const code = error?.code || '';
  const message = error instanceof Error ? error.message : String(error || '');
  const provider = context?.provider === 'google' ? 'google' : 'email';
  const hostname = typeof context?.hostname === 'string' && context.hostname.trim()
    ? context.hostname.trim()
    : (typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : '');

  if (code === 'auth/invalid-email' || code === 'auth/missing-email') {
    return t.authErrInvalidEmail || 'صيغة البريد الإلكتروني غير صحيحة.';
  }
  if (code === 'auth/missing-password') {
    return t.authErrWeakPassword || 'يرجى إدخال كلمة المرور (6 أحرف على الأقل).';
  }
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return t.authErrInvalidCredentials || 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }
  if (code === 'auth/email-already-in-use') {
    return t.authErrEmailInUse || 'هذا البريد الإلكتروني مسجل مسبقاً. جرّب تسجيل الدخول.';
  }
  if (code === 'auth/weak-password') {
    return t.authErrWeakPassword || 'كلمة المرور ضعيفة (يجب أن تكون 6 أحرف على الأقل).';
  }
  if (code === 'auth/operation-not-allowed') {
    if (provider === 'google') {
      return t.authErrGoogleNotAllowed || 'تسجيل الدخول عبر Google غير مفعّل بعد في Firebase Authentication. فعّل مزوّد Google من لوحة Firebase.';
    }
    return t.authErrOperationNotAllowed || 'تسجيل الدخول بالبريد وكلمة المرور غير مفعّل بعد في إعدادات Firebase Authentication. فعّله من لوحة Firebase أو استخدم الدخول السريع عبر Google.';
  }
  if (code === 'auth/configuration-not-found' || code === 'auth/invalid-api-key') {
    return t.authErrConfigNotFound || 'إعدادات Firebase Authentication غير مكتملة لهذا المشروع. تأكد من تفعيل Authentication في لوحة Firebase.';
  }
  if (code === 'auth/user-disabled') {
    return t.authErrUserDisabled || 'تم تعطيل هذا الحساب مؤقتاً. تواصل مع الدعم أو المسؤول.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return t.authErrPopupClosed || 'تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.';
  }
  if (code === 'auth/popup-blocked') {
    return t.authErrPopupBlocked || 'حظر المتصفح النافذة المنبثقة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.';
  }
  if (code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/web-storage-unsupported') {
    return t.authErrUnsupportedEnv || 'بيئة المتصفح الحالية تمنع نافذة المصادقة المنبثقة أو التخزين المحلي. افتح الموقع مباشرة في المتصفح ثم أعد المحاولة.';
  }
  if (code === 'auth/unauthorized-domain') {
    const baseMsg = t.authErrUnauthorizedDomain || 'هذا النطاق غير مصرّح به في Firebase Authentication. أضفه إلى Authorized domains في لوحة Firebase.';
    return hostname ? `${baseMsg} (${hostname})` : baseMsg;
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return t.authErrDifferentCredential || 'يوجد حساب مسجل مسبقاً بنفس البريد عبر طريقة دخول أخرى.';
  }
  if (code === 'auth/too-many-requests') {
    return t.authErrTooManyRequests || 'محاولات متكررة كثيرة. انتظر قليلاً ثم أعد المحاولة.';
  }
  if (code === 'auth/network-request-failed' || code === 'unavailable' || /the client is offline/i.test(message)) {
    return t.authErrNetwork || 'تعذر الاتصال بالشبكة أثناء المصادقة. تحقق من الاتصال ثم أعد المحاولة.';
  }
  if (code === 'auth/internal-error') {
    return t.authErrInternal || 'حدث خطأ مؤقت في خدمة المصادقة. أعد المحاولة بعد لحظات.';
  }
  return message || t.genericError || 'تعذر إتمام عملية تسجيل الدخول.';
}
