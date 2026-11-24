import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_EMAIL,
  GLOBAL_ADMIN_CAPACITY_TARGET,
  buildInitialUserProfile,
  clampCredits,
  clampDailyLimit,
  computeAdminCapacitySummary,
  filterAndSortUsers,
  isAdminEmailUnverified,
  isAdminUser,
  isUserProfileCycleExpired,
  mapFirebaseAuthError
} from './authAdmin.js';

test('grants admin access strictly and exclusively to verified poppqwe9k@gmail.com', () => {
  assert.equal(ADMIN_EMAIL, 'poppqwe9k@gmail.com');
  assert.equal(isAdminUser({ email: 'poppqwe9k@gmail.com', emailVerified: true }), true);
  assert.equal(isAdminUser({ email: 'Poppqwe9k@gmail.com', emailVerified: true }), true);

  // Unverified spoof attempt must be rejected as admin
  assert.equal(isAdminUser({ email: 'poppqwe9k@gmail.com', emailVerified: false }), false);
  assert.equal(isAdminEmailUnverified({ email: 'poppqwe9k@gmail.com', emailVerified: false }), true);

  // Other accounts (even close typos) must never be admin
  assert.equal(isAdminUser({ email: 'poppqwe9j@gmail.com', emailVerified: true }), false);
  assert.equal(isAdminUser({ email: 'user@example.com', emailVerified: true }), false);
  assert.equal(isAdminUser(null), false);
});

test('initializes new account profile with 3 daily free messages and free plan', () => {
  const now = Date.UTC(2026, 10, 23, 14, 0, 0);
  const profile = buildInitialUserProfile({
    uid: 'user_123',
    email: 'ali@example.com',
    displayName: 'علي',
    now,
    todayKey: '2026-11-23'
  });

  assert.equal(profile.uid, 'user_123');
  assert.equal(profile.email, 'ali@example.com');
  assert.equal(profile.displayName, 'علي');
  assert.equal(profile.plan, 'free');
  assert.equal(profile.dailyLimit, 3);
  assert.equal(profile.remainingCredits, 3);
  assert.equal(profile.totalUsed, 0);
  assert.equal(profile.visitsCount, 1);
  assert.equal(profile.cycleStartedAt, now);
  assert.equal(profile.lastResetDate, '2026-11-23');
});

test('computes remaining global capacity out of 200 messages for Admin Panel', () => {
  assert.equal(GLOBAL_ADMIN_CAPACITY_TARGET, 200);

  const full = computeAdminCapacitySummary({
    validKeyCount: 10,
    totalCapacity: 200,
    remaining: 200,
    usedCount: 0
  });
  assert.equal(full.targetCapacity, 200);
  assert.equal(full.remaining, 200);
  assert.equal(full.used, 0);
  assert.equal(full.percentRemaining, 100);

  const partial = computeAdminCapacitySummary({
    validKeyCount: 10,
    totalCapacity: 200,
    remaining: 155,
    usedCount: 45
  });
  assert.equal(partial.remaining, 155);
  assert.equal(partial.used, 45);
  assert.equal(partial.percentRemaining, 78);

  const noKeys = computeAdminCapacitySummary({
    validKeyCount: 0,
    totalCapacity: 0,
    remaining: 0,
    usedCount: 0
  });
  assert.equal(noKeys.remaining, 0);
  assert.equal(noKeys.percentRemaining, 0);
});

test('checks 24h cycle expiration and clamps admin edits safely', () => {
  const t0 = 1_700_000_000_000;
  assert.equal(isUserProfileCycleExpired({ cycleStartedAt: t0 }, t0 + 86_399_000), false);
  assert.equal(isUserProfileCycleExpired({ cycleStartedAt: t0 }, t0 + 86_400_000), true);
  assert.equal(clampDailyLimit(50), 50);
  assert.equal(clampDailyLimit(-5, 3), 3);
  assert.equal(clampDailyLimit(999999), 10000);
  assert.equal(clampCredits(-2, 0), 0);
});

test('filters and sorts registered users by search query and activity timestamp', () => {
  const users = [
    { uid: '1', displayName: 'سارة', email: 'sara@mail.com', plan: 'free', cycleStartedAt: 100 },
    { uid: '2', displayName: 'أحمد', email: 'ahmed@mail.com', plan: 'vip', cycleStartedAt: 300 },
    { uid: '3', displayName: 'نور', email: 'noor@mail.com', plan: 'pro', cycleStartedAt: 200 }
  ];

  const sorted = filterAndSortUsers(users, '');
  assert.deepEqual(sorted.map((u) => u.uid), ['2', '3', '1']);

  const filtered = filterAndSortUsers(users, 'vip');
  assert.deepEqual(filtered.map((u) => u.uid), ['2']);
});

test('maps Firebase Auth error codes to localized readable messages', () => {
  assert.match(mapFirebaseAuthError({ code: 'auth/invalid-credential' }), /غير صحيحة/);
  assert.match(mapFirebaseAuthError({ code: 'auth/operation-not-allowed' }), /Google/);
});
