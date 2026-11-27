import React from 'react';
import {
  DAILY_HYDROGEN_LIMIT,
  MODEL_FLASH_LITE,
  MODEL_HYDROGEN
} from '../utils/hydrogenQuota.js';

export default function HydrogenQuotaBar({
  selectedModel,
  remainingCount,
  dailyLimit = DAILY_HYDROGEN_LIMIT,
  autoSwitchedToLite = false,
  noticeDismissed = false,
  highlightNotice = false,
  onDismissNotice
}) {
  const safeLimit = Math.max(1, Math.floor(Number(dailyLimit) || DAILY_HYDROGEN_LIMIT));
  const safeRemaining = Math.max(0, Math.floor(Number(remainingCount) || 0));
  const isHydrogenSelected = selectedModel === MODEL_HYDROGEN;
  const isExhausted = safeRemaining <= 0;
  const showCounterBar = isHydrogenSelected;
  const showNotice = (isExhausted || autoSwitchedToLite) && !noticeDismissed;

  if (!showCounterBar && !showNotice) {
    return null;
  }

  return (
    <div className="hydrogen-quota-wrap" data-testid="hydrogen-quota-bar">
      {showCounterBar && (
        <div className="hydrogen-quota-bar">
          <span className="hydrogen-quota-label">
            محاولات <strong dir="ltr">{MODEL_HYDROGEN}</strong> اليوم:
          </span>
          <strong className="hydrogen-quota-count" data-testid="hydrogen-quota-count">
            {safeRemaining}/{safeLimit} متبقية اليوم
          </strong>
        </div>
      )}

      {showNotice && (
        <div
          className={`hydrogen-quota-notice ${highlightNotice ? 'hydrogen-quota-notice-highlight' : ''}`}
          data-testid="credits-exhausted-notice"
          role="status"
        >
          <span className="hydrogen-quota-notice-text">
            انتهت محاولات <strong dir="ltr">{MODEL_HYDROGEN}</strong> لليوم، وتم التحويل
            تلقائياً إلى <strong dir="ltr">{MODEL_FLASH_LITE}</strong> المفتوح بلا حدود
            {selectedModel === MODEL_FLASH_LITE ? '.' : ' للأسئلة اليومية.'}
          </span>
          {onDismissNotice && (
            <button
              type="button"
              className="hydrogen-quota-dismiss"
              onClick={onDismissNotice}
            >
              إغلاق
            </button>
          )}
        </div>
      )}
    </div>
  );
}
