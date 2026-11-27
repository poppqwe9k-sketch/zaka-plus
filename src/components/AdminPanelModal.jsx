import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  USER_PLANS,
  clampCredits,
  clampDailyLimit,
  computeDualModelCapacitySummary,
  filterAndSortUsers,
  filterUsersDirectory,
  isAdminAccountRecord,
  isPaidPlanUser,
  isUserBanned,
  normalizePlan
} from '../utils/authAdmin.js';
import { formatPacificResetCountdown } from '../utils/pacificTime.js';

function formatCapacityNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');
}

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
  plusDailyQuota = null,
  quotaAnalytics = null,
  onRefreshQuota,
  onRefreshDashboard,
  usersList,
  analytics,
  onUpdateUserSubscription,
  onToggleUserBan,
  currentUserUid = '',
  initialVisitsUsersOpen = false,
  initialBanUsersOpen = false,
  langCode = 'ar',
  t
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDirectoryTab, setActiveDirectoryTab] = useState('paid');
  const [visitsUsersOpen, setVisitsUsersOpen] = useState(Boolean(initialVisitsUsersOpen));
  const [banUsersOpen, setBanUsersOpen] = useState(Boolean(initialBanUsersOpen));
  const [banBusyUid, setBanBusyUid] = useState('');
  const [banFeedback, setBanFeedback] = useState('');
  const [banError, setBanError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refreshTimerRef = useRef(null);

  useEffect(() => {
    if (open) {
      setFeedback('');
      setErrorMsg('');
      setBanFeedback('');
      setBanError('');
      setBanBusyUid('');
      setRefreshNotice('');
      setActiveDirectoryTab('paid');
      setVisitsUsersOpen(Boolean(initialVisitsUsersOpen));
      setBanUsersOpen(Boolean(initialBanUsersOpen));
      setNowMs(Date.now());
      onRefreshQuota?.();
    }
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [open, onRefreshQuota, initialVisitsUsersOpen, initialBanUsersOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const ticker = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(ticker);
  }, [open]);

  const dualCapacity = useMemo(
    () => computeDualModelCapacitySummary({ dailyQuota, plusDailyQuota, quotaAnalytics, now: nowMs }),
    [dailyQuota, plusDailyQuota, quotaAnalytics, nowMs]
  );
  const ptCountdown = useMemo(
    () => formatPacificResetCountdown(nowMs),
    [nowMs]
  );
  const allUsersSorted = useMemo(() => filterAndSortUsers(usersList, ''), [usersList]);
  const paidUsersCount = useMemo(
    () => allUsersSorted.filter((u) => isPaidPlanUser(u)).length,
    [allUsersSorted]
  );
  const displayedUsers = useMemo(
    () => filterUsersDirectory(usersList, {
      query: searchQuery,
      paidOnly: activeDirectoryTab === 'paid'
    }),
    [usersList, searchQuery, activeDirectoryTab]
  );

  if (!open) return null;

  const totalUsersCount = Math.max(
    allUsersSorted.length,
    Number(analytics?.registeredUsersCount) || 0
  );
  const totalVisitsCount = Math.max(
    Number(analytics?.totalVisits) || 0,
    allUsersSorted.reduce((sum, u) => sum + Math.max(0, Number(u?.visitsCount) || 0), 0)
  );

  async function handleManualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setErrorMsg('');
    setRefreshNotice('');
    try {
      if (typeof onRefreshDashboard === 'function') {
        await onRefreshDashboard();
      } else if (typeof onRefreshQuota === 'function') {
        await onRefreshQuota();
      }
      setRefreshNotice(t.adminRefreshedNotice || 'تم التحديث');
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => setRefreshNotice(''), 3500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t.genericError);
    } finally {
      setRefreshing(false);
    }
  }

  function handleToggleVisitsUsers() {
    setVisitsUsersOpen((prev) => !prev);
  }

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

  async function handleToggleBanUser(userRecord) {
    const targetUid = userRecord?.uid || userRecord?.id || '';
    if (!targetUid || banBusyUid) return;
    if (isAdminAccountRecord(userRecord, currentUserUid)) {
      setBanError(t.adminBanSelfBlocked || 'لا يمكن حظر حساب المسؤول');
      return;
    }
    const nextBanned = !isUserBanned(userRecord);
    setBanBusyUid(targetUid);
    setBanError('');
    setBanFeedback('');
    try {
      await onToggleUserBan?.(targetUid, nextBanned);
      setBanFeedback(
        nextBanned
          ? (t.adminBanUpdatedSuccess || 'تم حظر المستخدم بنجاح.')
          : (t.adminUnbanUpdatedSuccess || 'تم إلغاء حظر المستخدم بنجاح.')
      );
    } catch (err) {
      setBanError(err instanceof Error ? err.message : t.genericError);
    } finally {
      setBanBusyUid('');
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
          {/* Section 1: Independent Per-Model Daily Capacity */}
          <section className="admin-section" data-testid="admin-capacity-section">
            <div className="admin-section-head">
              <h3>{t.adminGlobalCapacityTitle}</h3>
              <div className="admin-refresh-group">
                {refreshNotice && (
                  <span
                    className="admin-refresh-notice"
                    role="status"
                    aria-live="polite"
                    data-testid="admin-refresh-status"
                  >
                    {refreshNotice}
                  </span>
                )}
                <button
                  type="button"
                  className="admin-quick-btn"
                  data-testid="admin-refresh-button"
                  disabled={refreshing}
                  onClick={handleManualRefresh}
                >
                  {refreshing ? (t.adminRefreshingLabel || 'جاري التحديث...') : t.adminRefreshButton}
                </button>
              </div>
            </div>

            <div className="admin-models-capacity-grid">
              <div className="admin-capacity-card" data-testid="admin-capacity-plus-plus">
                <div className="admin-capacity-model-head">
                  <strong className="admin-capacity-model-title" dir="auto">
                    {t.adminModelPlusPlusTitle || 'نموذج بلس بلاس (gemini-4-hydrogen)'}
                  </strong>
                  <span className="admin-capacity-percent">{dualCapacity.plusPlus.percentRemaining}%</span>
                </div>
                <div className="admin-capacity-numbers">
                  <span className="admin-capacity-label">
                    {t.adminRemainingTodayLabel || 'الرسائل المتبقية اليوم'}
                  </span>
                  <div className="admin-capacity-main" data-testid="admin-capacity-plus-plus-value">
                    {formatCapacityNumber(dualCapacity.plusPlus.remaining)}{' '}
                    <span>/ {formatCapacityNumber(dualCapacity.plusPlus.targetCapacity)} {t.creditsUnitSingle}</span>
                  </div>
                </div>
                <div className="admin-progress-track" aria-hidden="true">
                  <div
                    className="admin-progress-fill admin-progress-fill-plus-plus"
                    data-testid="admin-progress-plus-plus"
                    style={{ width: `${dualCapacity.plusPlus.percentRemaining}%` }}
                  />
                </div>
                <div className="admin-capacity-chars-row" data-testid="admin-chars-plus-plus">
                  <span className="admin-capacity-chars-label">
                    {t.adminCharsUsedTodayLabel || 'إجمالي الحروف المستهلكة اليوم'}
                  </span>
                  <strong className="admin-capacity-chars-value">
                    {formatCapacityNumber(dualCapacity.plusPlus.charsUsed)} {t.adminCharsUnit || 'حرف'}
                  </strong>
                </div>
                <div className="admin-capacity-reset-row" data-testid="admin-reset-countdown-plus-plus">
                  <span>
                    {t.adminResetCountdownLabel || 'التصفير التلقائي خلال'}:{' '}
                    <strong className="admin-reset-timer" dir="ltr">{ptCountdown.formatted}</strong>
                  </span>
                  <span className="admin-reset-baghdad">
                    ({ptCountdown.baghdadResetTime} {t.adminResetBaghdadSuffix || 'بتوقيت جوجل (بغداد)'})
                  </span>
                </div>
                <span className="admin-section-meta">
                  {dualCapacity.plusPlus.validKeyCount > 0
                    ? `${dualCapacity.plusPlus.validKeyCount} ${t.adminActiveKeysLabel} · ${t.adminRenews24h}`
                    : t.adminNoKeysActive}
                </span>
              </div>

              <div className="admin-capacity-card" data-testid="admin-capacity-plus">
                <div className="admin-capacity-model-head">
                  <strong className="admin-capacity-model-title" dir="auto">
                    {t.adminModelPlusTitle || 'نموذج بلس (gemini-3.5-flash-lite)'}
                  </strong>
                  <span className="admin-capacity-percent">{dualCapacity.plus.percentRemaining}%</span>
                </div>
                <div className="admin-capacity-numbers">
                  <span className="admin-capacity-label">
                    {t.adminRemainingTodayLabel || 'الرسائل المتبقية اليوم'}
                  </span>
                  <div className="admin-capacity-main" data-testid="admin-capacity-plus-value">
                    {formatCapacityNumber(dualCapacity.plus.remaining)}{' '}
                    <span>/ {formatCapacityNumber(dualCapacity.plus.targetCapacity)} {t.creditsUnitSingle}</span>
                  </div>
                </div>
                <div className="admin-progress-track" aria-hidden="true">
                  <div
                    className="admin-progress-fill admin-progress-fill-plus"
                    data-testid="admin-progress-plus"
                    style={{ width: `${dualCapacity.plus.percentRemaining}%` }}
                  />
                </div>
                <div className="admin-capacity-chars-row" data-testid="admin-chars-plus">
                  <span className="admin-capacity-chars-label">
                    {t.adminCharsUsedTodayLabel || 'إجمالي الحروف المستهلكة اليوم'}
                  </span>
                  <strong className="admin-capacity-chars-value">
                    {formatCapacityNumber(dualCapacity.plus.charsUsed)} {t.adminCharsUnit || 'حرف'}
                  </strong>
                </div>
                <div className="admin-capacity-reset-row" data-testid="admin-reset-countdown-plus">
                  <span>
                    {t.adminResetCountdownLabel || 'التصفير التلقائي خلال'}:{' '}
                    <strong className="admin-reset-timer" dir="ltr">{ptCountdown.formatted}</strong>
                  </span>
                  <span className="admin-reset-baghdad">
                    ({ptCountdown.baghdadResetTime} {t.adminResetBaghdadSuffix || 'بتوقيت جوجل (بغداد)'})
                  </span>
                </div>
                <span className="admin-section-meta">
                  {dualCapacity.plus.validKeyCount > 0
                    ? `${dualCapacity.plus.validKeyCount} ${t.adminActiveKeysLabel} · ${t.adminRenews24h}`
                    : t.adminNoKeysActive}
                </span>
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
              <button
                type="button"
                className={`admin-stat-card admin-stat-card-btn ${visitsUsersOpen ? 'is-open' : ''}`}
                data-testid="admin-registered-users"
                aria-expanded={visitsUsersOpen}
                aria-controls="admin-visits-users-dropdown"
                onClick={handleToggleVisitsUsers}
              >
                <span className="admin-stat-label">{t.adminRegisteredUsersLabel}</span>
                <span className="admin-stat-value">{totalUsersCount}</span>
                <span className="admin-stat-hint">
                  <span>{visitsUsersOpen ? t.adminCloseUsersListHint : t.adminOpenUsersListHint}</span>
                  <span className="admin-stat-chevron" aria-hidden="true">▾</span>
                </span>
              </button>
            </div>

            {visitsUsersOpen && (
              <div
                id="admin-visits-users-dropdown"
                className="admin-visits-list"
                data-testid="admin-visits-dropdown"
              >
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
            )}
          </section>

          {/* Section 2.5: User Ban Management */}
          <section className="admin-section" data-testid="admin-ban-section">
            <div className="admin-section-head">
              <h3>{t.adminBanUsersTitle || 'إدارة وحظر المستخدمين'}</h3>
              <button
                type="button"
                className={`admin-ban-users-btn ${banUsersOpen ? 'is-open' : ''}`}
                data-testid="admin-ban-users-button"
                aria-expanded={banUsersOpen}
                aria-controls="admin-ban-users-panel"
                onClick={() => setBanUsersOpen((prev) => !prev)}
              >
                <span>{t.adminBanUsersButton || 'حظر مستخدمين'}</span>
                <span className="admin-ban-users-count" data-testid="admin-ban-users-count">
                  ({allUsersSorted.length})
                </span>
              </button>
            </div>

            {banUsersOpen && (
              <div
                id="admin-ban-users-panel"
                className="admin-ban-panel"
                data-testid="admin-ban-users-panel"
              >
                {banFeedback && (
                  <div className="admin-feedback" role="status" data-testid="admin-ban-feedback">
                    {banFeedback}
                  </div>
                )}
                {banError && (
                  <div className="auth-error" role="alert" data-testid="admin-ban-error">
                    {banError}
                  </div>
                )}

                {allUsersSorted.length === 0 ? (
                  <div className="admin-empty">{t.adminNoUsersYet}</div>
                ) : (
                  <div className="admin-ban-list">
                    {allUsersSorted.map((u) => {
                      const targetUid = u.uid || u.id || '';
                      const banned = isUserBanned(u);
                      const isProtectedAdmin = isAdminAccountRecord(u, currentUserUid);
                      const isRowBusy = banBusyUid === targetUid;
                      return (
                        <div
                          key={`ban-${targetUid}`}
                          className={`admin-ban-row ${banned ? 'is-banned' : ''}`}
                          data-testid={`admin-ban-row-${targetUid}`}
                        >
                          <div className="admin-ban-user-info">
                            <div className="admin-ban-user-head">
                              <strong>{u.displayName || t.adminUnnamedUser}</strong>
                              <span
                                className={`admin-ban-status-badge ${banned ? 'status-banned' : 'status-active'}`}
                                data-testid={`admin-ban-status-${targetUid}`}
                              >
                                {banned ? (t.adminUserStatusBanned || 'محظور') : (t.adminUserStatusActive || 'نشط')}
                              </span>
                            </div>
                            <span className="admin-ban-user-email">{u.email || targetUid}</span>
                            <code className="admin-ban-user-uid" dir="ltr">{targetUid}</code>
                          </div>

                          <button
                            type="button"
                            className={`admin-ban-action-btn ${banned ? 'is-unban' : 'is-ban'}`}
                            data-testid={`admin-ban-toggle-${targetUid}`}
                            disabled={isRowBusy || isProtectedAdmin}
                            title={isProtectedAdmin ? (t.adminBanSelfBlocked || 'لا يمكن حظر حساب المسؤول') : undefined}
                            onClick={() => handleToggleBanUser(u)}
                          >
                            {isRowBusy
                              ? t.authSubmitting
                              : (banned ? (t.adminUnbanButton || 'إلغاء الحظر') : (t.adminBanButton || 'حظر'))}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Section 3: Subscriptions & More */}
          <section
            className="admin-section"
            data-testid="admin-subscriptions-section"
          >
            <div className="admin-section-head">
              <h3>{t.adminSubscriptionsTitle}</h3>
              <span className="admin-section-meta">
                {displayedUsers.length} {t.adminUsersCountSuffix}
              </span>
            </div>

            <div
              className="admin-directory-tabs"
              role="tablist"
              aria-label={t.adminSubscriptionsTitle}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeDirectoryTab === 'paid'}
                data-testid="admin-tab-paid"
                className={`admin-directory-tab ${activeDirectoryTab === 'paid' ? 'active' : ''}`}
                onClick={() => setActiveDirectoryTab('paid')}
              >
                {t.adminPaidSubscribersTab} ({paidUsersCount})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeDirectoryTab === 'users'}
                data-testid="admin-tab-users"
                className={`admin-directory-tab ${activeDirectoryTab === 'users' ? 'active' : ''}`}
                onClick={() => setActiveDirectoryTab('users')}
              >
                {t.adminAllUsersTab} ({allUsersSorted.length})
              </button>
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
              {displayedUsers.length === 0 ? (
                <div className="admin-empty">
                  {activeDirectoryTab === 'paid' && !searchQuery.trim() ? (
                    <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
                      <span>{t.adminNoPaidSubscribers}</span>
                      <button
                        type="button"
                        className="admin-quick-btn"
                        onClick={() => setActiveDirectoryTab('users')}
                      >
                        {t.adminAllUsersTab} ({allUsersSorted.length})
                      </button>
                    </div>
                  ) : (
                    t.adminNoMatchingUsers
                  )}
                </div>
              ) : (
                displayedUsers.map((u) => (
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
