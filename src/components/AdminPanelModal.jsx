import React, { useEffect, useMemo, useState } from 'react';
import {
  USER_PLANS,
  clampCredits,
  clampDailyLimit,
  computeAdminCapacitySummary,
  filterAndSortUsers,
  normalizePlan
} from '../utils/authAdmin.js';

function formatVisitTimestamp(ts, locale = 'ar') {
  if (!ts) return '—';
  const ms = typeof ts?.toMillis === 'function' ? ts.toMillis() : Number(ts);
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ms));
  } catch {
    return '—';
  }
}

function AdminUserSubscriptionRow({ user, onSave, t }) {
  const [plan, setPlan] = useState(() => normalizePlan(user.plan));
  const [dailyLimit, setDailyLimit] = useState(() => clampDailyLimit(user.dailyLimit));
  const [remainingCredits, setRemainingCredits] = useState(() => clampCredits(user.remainingCredits, 3));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPlan(normalizePlan(user.plan));
    setDailyLimit(clampDailyLimit(user.dailyLimit));
    setRemainingCredits(clampCredits(user.remainingCredits, 3));
  }, [user.plan, user.dailyLimit, user.remainingCredits]);

  async function saveChanges(nextValues) {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(user.uid || user.id, nextValues);
    } finally {
      setSaving(false);
    }
  }

  function handlePlanSelectChange(nextPlan) {
    const normalized = normalizePlan(nextPlan);
    setPlan(normalized);
    const preset = USER_PLANS.find((p) => p.id === normalized);
    if (preset) {
      const nextLimit = Math.max(dailyLimit, preset.defaultDailyLimit);
      const bumpedLimit = normalized === 'free' ? 3 : nextLimit;
      setDailyLimit(bumpedLimit);
      setRemainingCredits((prev) => Math.max(prev, bumpedLimit));
    }
  }

  return (
    <div className="admin-user-card" data-testid={`admin-user-row-${user.uid || user.id}`}>
      <div className="admin-user-top">
        <div className="admin-user-identity">
          <strong>{user.displayName || t.adminUnnamedUser}</strong>
          <span>{user.email}</span>
        </div>
        <span className={`sidebar-plan-tag plan-${plan}`}>
          {plan === 'vip' ? 'VIP' : (plan === 'pro' ? t.planPro : t.planFree)}
        </span>
      </div>

      <div className="admin-user-controls">
        <div className="admin-control-field">
          <label htmlFor={`plan-${user.uid}`}>{t.adminPlanLabel}</label>
          <select
            id={`plan-${user.uid}`}
            value={plan}
            onChange={(e) => handlePlanSelectChange(e.target.value)}
          >
            <option value="free">{t.planFree}</option>
            <option value="pro">{t.planPro}</option>
            <option value="vip">VIP</option>
          </select>
        </div>

        <div className="admin-control-field">
          <label htmlFor={`limit-${user.uid}`}>{t.adminDailyLimitLabel}</label>
          <input
            id={`limit-${user.uid}`}
            type="number"
            min={1}
            max={10000}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
          />
        </div>

        <div className="admin-control-field">
          <label htmlFor={`credits-${user.uid}`}>{t.adminRemainingCreditsLabel}</label>
          <input
            id={`credits-${user.uid}`}
            type="number"
            min={0}
            max={100000}
            value={remainingCredits}
            onChange={(e) => setRemainingCredits(e.target.value)}
          />
        </div>

        <button
          type="button"
          className="admin-save-btn"
          disabled={saving}
          onClick={() =>
            saveChanges({
              plan,
              dailyLimit: clampDailyLimit(dailyLimit),
              remainingCredits: clampCredits(remainingCredits, clampDailyLimit(dailyLimit))
            })
          }
        >
          {saving ? t.authSubmitting : t.adminSaveButton}
        </button>
      </div>

      <div className="admin-quick-actions">
        <button
          type="button"
          className="admin-quick-btn"
          disabled={saving}
          onClick={() =>
            saveChanges({
              plan,
              dailyLimit: clampDailyLimit(dailyLimit),
              remainingCredits: clampCredits(Number(remainingCredits) + 5)
            })
          }
        >
          +5 {t.creditsUnitPlural}
        </button>
        <button
          type="button"
          className="admin-quick-btn"
          disabled={saving}
          onClick={() =>
            saveChanges({
              plan: 'pro',
              dailyLimit: Math.max(25, clampDailyLimit(dailyLimit)),
              remainingCredits: Math.max(25, clampCredits(remainingCredits))
            })
          }
        >
          {t.adminUpgradeProButton}
        </button>
        <button
          type="button"
          className="admin-quick-btn"
          disabled={saving}
          onClick={() =>
            saveChanges({
              plan: 'vip',
              dailyLimit: Math.max(100, clampDailyLimit(dailyLimit)),
              remainingCredits: Math.max(100, clampCredits(remainingCredits))
            })
          }
        >
          {t.adminUpgradeVipButton}
        </button>
      </div>
    </div>
  );
}

export default function AdminPanelModal({
  open,
  onClose,
  dailyQuota,
  onRefreshQuota,
  usersList,
  analytics,
  onUpdateUserSubscription,
  langCode = 'ar',
  t
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (open) {
      setFeedback('');
      setErrorMsg('');
      onRefreshQuota?.();
    }
  }, [open, onRefreshQuota]);

  const capacity = useMemo(() => computeAdminCapacitySummary(dailyQuota), [dailyQuota]);
  const sortedUsers = useMemo(
    () => filterAndSortUsers(usersList, searchQuery),
    [usersList, searchQuery]
  );
  const allUsersSorted = useMemo(() => filterAndSortUsers(usersList, ''), [usersList]);

  if (!open) return null;

  const totalUsersCount = Math.max(
    allUsersSorted.length,
    Number(analytics?.registeredUsersCount) || 0
  );
  const totalVisitsCount = Math.max(
    Number(analytics?.totalVisits) || 0,
    allUsersSorted.reduce((sum, u) => sum + Math.max(0, Number(u?.visitsCount) || 0), 0)
  );

  async function handleSaveUser(uid, updates) {
    setErrorMsg('');
    setFeedback('');
    try {
      await onUpdateUserSubscription(uid, updates);
      setFeedback(t.adminSaveSuccess);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t.genericError);
    }
  }

  return (
    <div
      className="admin-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-panel-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="admin-dialog" data-testid="admin-panel-modal">
        <div className="admin-header">
          <div className="admin-header-title">
            <h2 id="admin-panel-title">{t.adminPanelTitle}</h2>
            <span className="admin-badge-pill">Admin</span>
          </div>
          <button
            type="button"
            className="auth-close"
            onClick={onClose}
            aria-label={t.authCloseAria}
          >
            ×
          </button>
        </div>

        <div className="admin-body">
          {/* Section 1: Global Capacity out of 200 */}
          <section className="admin-section" data-testid="admin-capacity-section">
            <div className="admin-section-head">
              <h3>{t.adminGlobalCapacityTitle}</h3>
              <button
                type="button"
                className="admin-quick-btn"
                onClick={() => onRefreshQuota?.()}
              >
                {t.adminRefreshButton}
              </button>
            </div>

            <div className="admin-capacity-card">
              <div className="admin-capacity-numbers">
                <div className="admin-capacity-main" data-testid="admin-capacity-value">
                  {capacity.remaining} <span>/ {capacity.targetCapacity} {t.creditsUnitSingle}</span>
                </div>
                <span className="admin-section-meta">
                  {capacity.validKeyCount > 0
                    ? `${capacity.validKeyCount} ${t.adminActiveKeysLabel} · ${t.adminRenews24h}`
                    : t.adminNoKeysActive}
                </span>
              </div>
              <div className="admin-progress-track" aria-hidden="true">
                <div
                  className="admin-progress-fill"
                  style={{ width: `${capacity.percentRemaining}%` }}
                />
              </div>
            </div>
          </section>

          {/* Section 2: Views & Visits List */}
          <section className="admin-section" data-testid="admin-visits-section">
            <div className="admin-section-head">
              <h3>{t.adminVisitsSectionTitle}</h3>
              <span className="admin-section-meta">{t.adminVisitsLiveLabel}</span>
            </div>

            <div className="admin-stats-grid">
              <div className="admin-stat-card" data-testid="admin-total-visits">
                <span className="admin-stat-label">{t.adminTotalVisitsLabel}</span>
                <span className="admin-stat-value">{totalVisitsCount}</span>
              </div>
              <div className="admin-stat-card" data-testid="admin-registered-users">
                <span className="admin-stat-label">{t.adminRegisteredUsersLabel}</span>
                <span className="admin-stat-value">{totalUsersCount}</span>
              </div>
            </div>

            <div className="admin-visits-list">
              {allUsersSorted.length === 0 ? (
                <div className="admin-empty">{t.adminNoUsersYet}</div>
              ) : (
                allUsersSorted.map((u) => (
                  <div key={`visit-${u.uid || u.id}`} className="admin-visit-row">
                    <div className="admin-visit-user">
                      <strong>{u.displayName || t.adminUnnamedUser}</strong>
                      <span>{u.email}</span>
                    </div>
                    <div className="admin-visit-metrics">
                      <span>{u.visitsCount || 1} {t.adminVisitUnit}</span>
                      <span>·</span>
                      <span>{u.totalUsed || 0} {t.creditsUnitPlural}</span>
                      <span>·</span>
                      <span>{formatVisitTimestamp(u.lastActiveAt, langCode)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Section 3: Subscriptions Management */}
          <section className="admin-section" data-testid="admin-subscriptions-section">
            <div className="admin-section-head">
              <h3>{t.adminSubscriptionsTitle}</h3>
              <span className="admin-section-meta">
                {sortedUsers.length} {t.adminUsersCountSuffix}
              </span>
            </div>

            <input
              type="search"
              className="admin-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.adminSearchUsersPlaceholder}
              aria-label={t.adminSearchUsersPlaceholder}
            />

            {feedback && (
              <div className="admin-feedback" role="status">
                {feedback}
              </div>
            )}
            {errorMsg && (
              <div className="auth-error" role="alert">
                {errorMsg}
              </div>
            )}

            <div className="admin-users-list">
              {sortedUsers.length === 0 ? (
                <div className="admin-empty">{t.adminNoMatchingUsers}</div>
              ) : (
                sortedUsers.map((u) => (
                  <AdminUserSubscriptionRow
                    key={u.uid || u.id}
                    user={u}
                    onSave={handleSaveUser}
                    t={t}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
