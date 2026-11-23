import React, { useEffect, useRef, useState } from 'react';
import { SIMULATED_AD_DURATION_SECONDS } from '../utils/admobRewarded.js';

export default function RewardAdModal({
  open,
  onClose,
  onRewardEarned,
  t
}) {
  const [secondsLeft, setSecondsLeft] = useState(SIMULATED_AD_DURATION_SECONDS);
  const [completed, setCompleted] = useState(false);
  const rewardGrantedRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;

    rewardGrantedRef.current = false;
    setSecondsLeft(SIMULATED_AD_DURATION_SECONDS);
    setCompleted(false);

    const intervalId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(intervalId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [open]);

  useEffect(() => {
    if (open && secondsLeft === 0) {
      setCompleted(true);
      if (!rewardGrantedRef.current) {
        rewardGrantedRef.current = true;
        onRewardEarned?.();
      }
    }
  }, [open, secondsLeft, onRewardEarned]);

  if (!open) return null;

  const elapsed = SIMULATED_AD_DURATION_SECONDS - secondsLeft;
  const progressRatio = Math.min(1, Math.max(0, elapsed / SIMULATED_AD_DURATION_SECONDS));

  return (
    <div
      className="admob-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admob-modal-title"
    >
      <div className="admob-dialog">
        <div className="admob-dialog-header">
          <div>
            <div className="admob-kicker">{t.adSimulationKicker}</div>
            <h2 id="admob-modal-title">{t.adSimulationTitle}</h2>
          </div>
          {!completed && (
            <button
              type="button"
              className="admob-close-btn"
              onClick={onClose}
              aria-label={t.adCancelButton}
            >
              ×
            </button>
          )}
        </div>

        <div className="admob-stage">
          <div className="admob-countdown-ring" aria-live="polite">
            <span className="admob-countdown-number">
              {completed ? '✓' : secondsLeft}
            </span>
          </div>

          <p className="admob-stage-status">
            {completed
              ? t.adRewardGrantedMessage
              : `${t.adCountdownPrefix} ${secondsLeft} ${t.adCountdownUnit}`}
          </p>

          <p className="admob-stage-note">
            {t.adSimulationNote}
          </p>

          <div className="admob-progress-track" aria-hidden="true">
            <div
              className="admob-progress-fill"
              style={{ transform: `scaleX(${progressRatio})` }}
            />
          </div>
        </div>

        <div className="admob-dialog-actions">
          {completed ? (
            <button
              type="button"
              className="admob-primary-btn"
              onClick={onClose}
            >
              {t.adContinueButton}
            </button>
          ) : (
            <button
              type="button"
              className="admob-secondary-btn"
              onClick={onClose}
            >
              {t.adCancelButton}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
