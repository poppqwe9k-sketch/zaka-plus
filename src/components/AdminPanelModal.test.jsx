import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminPanelModal from './AdminPanelModal.jsx';
import AuthModal from './AuthModal.jsx';
import { getTranslation } from '../i18n/translations.js';

test('AdminPanelModal renders independent Plus Plus (200) and Plus (10,000) capacity cards with separate progress bars and shared Refresh', () => {
  const t = getTranslation('ar');
  const html = renderToStaticMarkup(
    <AdminPanelModal
      open={true}
      onClose={() => {}}
      dailyQuota={{ validKeyCount: 10, totalCapacity: 200, remaining: 185, usedCount: 15 }}
      plusDailyQuota={{ validKeyCount: 10, totalCapacity: 10000, remaining: 9940, usedCount: 60 }}
      quotaAnalytics={{ cycleStartedAt: Date.now() - 1000, plusPlusUsed: 15, plusUsed: 60 }}
      onRefreshQuota={() => {}}
      onRefreshDashboard={async () => {}}
      usersList={[
        {
          uid: 'u1',
          displayName: 'أحمد',
          email: 'ahmed@example.com',
          plan: 'free',
          dailyLimit: 3,
          remainingCredits: 2,
          visitsCount: 4,
          totalUsed: 1,
          cycleStartedAt: 1700000000000
        },
        {
          uid: 'u2',
          displayName: 'سارة',
          email: 'sara@example.com',
          plan: 'pro',
          dailyLimit: 25,
          remainingCredits: 20,
          visitsCount: 7,
          totalUsed: 5,
          cycleStartedAt: 1700000001000
        }
      ]}
      analytics={{ totalVisits: 12, registeredUsersCount: 2 }}
      onUpdateUserSubscription={async () => {}}
      langCode="ar"
      t={t}
    />
  );

  assert.match(html, /لوحة تحكم المسؤول/);
  assert.doesNotMatch(html, /السعة الكلية المتبقية \(من أصل 200 رسالة\)/);
  assert.match(html, /نموذج بلس بلاس \(جيمناي 4 هيدروجين\)/);
  assert.match(html, /185/);
  assert.match(html, /\/ 200/);
  assert.match(html, /نموذج بلس \(gemini-3\.5-flash-lite\)/);
  assert.match(html, /9,940/);
  assert.match(html, /\/ 10,000/);
  assert.match(html, /data-testid="admin-progress-plus-plus"/);
  assert.match(html, /data-testid="admin-progress-plus"/);
  assert.match(html, /data-testid="admin-refresh-button"/);
  assert.match(html, /إجمالي الزيارات والمشاهدات/);
  assert.match(html, /12/);
  assert.match(html, /<button[^>]*data-testid="admin-registered-users"[^>]*aria-expanded="false"/);
  assert.match(html, /المستخدمون المسجلون/);
  // Registered users list inside Views & Visits must be completely hidden by default
  assert.doesNotMatch(html, /data-testid="admin-visits-dropdown"/);
  assert.doesNotMatch(html, /ahmed@example\.com/);
  assert.match(html, /الاشتراكات والمزيد/);
  assert.match(html, /المشتركون \(الباقات المدفوعة\) \(1\)/);
  assert.match(html, /المستخدمين \(2\)/);
  // Paid tab is default: paid user sara appears in subscriptions list, while free user ahmed does not
  assert.match(html, /data-testid="admin-user-row-u2"/);
  assert.doesNotMatch(html, /data-testid="admin-user-row-u1"/);
  assert.match(html, /ترقية إلى بلس برو/);
  assert.match(html, /ترقية إلى VIP/);

  const expandedHtml = renderToStaticMarkup(
    <AdminPanelModal
      open={true}
      onClose={() => {}}
      dailyQuota={{ validKeyCount: 10, totalCapacity: 200, remaining: 185, usedCount: 15 }}
      plusDailyQuota={{ validKeyCount: 10, totalCapacity: 10000, remaining: 9940, usedCount: 60 }}
      onRefreshQuota={() => {}}
      onRefreshDashboard={async () => {}}
      initialVisitsUsersOpen={true}
      usersList={[
        {
          uid: 'u1',
          displayName: 'حيدر',
          email: 'haider@example.com',
          plan: 'free',
          dailyLimit: 3,
          remainingCredits: 2,
          visitsCount: 4,
          totalUsed: 1,
          cycleStartedAt: 1700000000000
        }
      ]}
      analytics={{ totalVisits: 5, registeredUsersCount: 1 }}
      onUpdateUserSubscription={async () => {}}
      langCode="ar"
      t={t}
    />
  );

  assert.match(expandedHtml, /<button[^>]*data-testid="admin-registered-users"[^>]*aria-expanded="true"/);
  assert.match(expandedHtml, /data-testid="admin-visits-dropdown"/);
  assert.match(expandedHtml, /haider@example\.com/);
});

test('AuthModal renders email/password inputs, login/signup tabs, and Google quick sign-in', () => {
  const t = getTranslation('ar');
  const html = renderToStaticMarkup(
    <AuthModal
      open={true}
      initialMode="signup"
      promptMessage=""
      onClose={() => {}}
      onSuccess={() => {}}
      t={t}
    />
  );

  assert.match(html, /الدخول السريع عبر Google/);
  assert.match(html, /تسجيل الدخول/);
  assert.match(html, /إنشاء حساب/);
  assert.match(html, /البريد الإلكتروني/);
  assert.match(html, /كلمة المرور/);
  assert.match(html, /3 رسائل مجانية يومياً/);
});
