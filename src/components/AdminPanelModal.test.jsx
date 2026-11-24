import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminPanelModal from './AdminPanelModal.jsx';
import AuthModal from './AuthModal.jsx';
import { getTranslation } from '../i18n/translations.js';

test('AdminPanelModal renders global 200 capacity indicator, visits stats/list, and subscriptions controls', () => {
  const t = getTranslation('ar');
  const html = renderToStaticMarkup(
    <AdminPanelModal
      open={true}
      onClose={() => {}}
      dailyQuota={{ validKeyCount: 10, totalCapacity: 200, remaining: 185, usedCount: 15 }}
      onRefreshQuota={() => {}}
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
        }
      ]}
      analytics={{ totalVisits: 12, registeredUsersCount: 3 }}
      onUpdateUserSubscription={async () => {}}
      langCode="ar"
      t={t}
    />
  );

  assert.match(html, /لوحة تحكم المسؤول/);
  assert.match(html, /185/);
  assert.match(html, /\/ 200/);
  assert.match(html, /إجمالي الزيارات والمشاهدات/);
  assert.match(html, /12/);
  assert.match(html, /المستخدمون المسجلون/);
  assert.match(html, /3/);
  assert.match(html, /إدارة الاشتراكات والحصص/);
  assert.match(html, /ahmed@example\.com/);
  assert.match(html, /ترقية إلى بلس برو/);
  assert.match(html, /ترقية إلى VIP/);
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
