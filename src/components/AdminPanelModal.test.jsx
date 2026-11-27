import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminPanelModal from './AdminPanelModal.jsx';
import { getTranslation } from '../i18n/translations.js';

const sampleUsers = [
  {
    uid: 'uid_admin_1',
    displayName: 'المسؤول',
    email: 'poppqwe9k@gmail.com',
    plan: 'vip',
    dailyLimit: 100,
    remainingCredits: 100,
    visitsCount: 12,
    totalUsed: 4,
    cycleStartedAt: 1700000000300,
    banned: false
  },
  {
    uid: 'uid_active_2',
    displayName: 'سارة',
    email: 'sara@example.com',
    plan: 'free',
    dailyLimit: 3,
    remainingCredits: 2,
    visitsCount: 3,
    totalUsed: 1,
    cycleStartedAt: 1700000000200,
    banned: false
  },
  {
    uid: 'uid_banned_3',
    displayName: 'خالد',
    email: 'khaled@example.com',
    plan: 'pro',
    dailyLimit: 25,
    remainingCredits: 20,
    visitsCount: 5,
    totalUsed: 5,
    cycleStartedAt: 1700000000100,
    banned: true
  }
];

test('renders "حظر مستخدمين" button with registered Firestore users count and ban toggle list', () => {
  const t = getTranslation('ar');

  const closedMarkup = renderToStaticMarkup(
    <AdminPanelModal
      open
      onClose={() => {}}
      dailyQuota={null}
      usersList={sampleUsers}
      analytics={{ totalVisits: 20, registeredUsersCount: 3 }}
      onUpdateUserSubscription={() => {}}
      onToggleUserBan={() => {}}
      currentUserUid="uid_admin_1"
      initialBanUsersOpen={false}
      t={t}
    />
  );

  assert.match(closedMarkup, /data-testid="admin-ban-users-button"/);
  assert.match(closedMarkup, /حظر مستخدمين/);
  assert.match(closedMarkup, /\(3\)/);
  assert.doesNotMatch(closedMarkup, /data-testid="admin-ban-users-panel"/);

  const openMarkup = renderToStaticMarkup(
    <AdminPanelModal
      open
      onClose={() => {}}
      dailyQuota={null}
      usersList={sampleUsers}
      analytics={{ totalVisits: 20, registeredUsersCount: 3 }}
      onUpdateUserSubscription={() => {}}
      onToggleUserBan={() => {}}
      currentUserUid="uid_admin_1"
      initialBanUsersOpen
      t={t}
    />
  );

  assert.match(openMarkup, /data-testid="admin-ban-users-panel"/);
  assert.match(openMarkup, /sara@example\.com/);
  assert.match(openMarkup, /khaled@example\.com/);
  assert.match(openMarkup, /uid_active_2/);
  assert.match(openMarkup, /uid_banned_3/);
  assert.match(openMarkup, /data-testid="admin-ban-status-uid_active_2"[^>]*>نشط</);
  assert.match(openMarkup, /data-testid="admin-ban-status-uid_banned_3"[^>]*>محظور</);
  assert.match(openMarkup, /data-testid="admin-ban-toggle-uid_active_2"[^>]*>حظر</);
  assert.match(openMarkup, /data-testid="admin-ban-toggle-uid_banned_3"[^>]*>إلغاء الحظر</);
  assert.match(openMarkup, /data-testid="admin-ban-toggle-uid_admin_1"[^>]*disabled=""/);
});
