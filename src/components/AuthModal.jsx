import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase.js';
import { mapFirebaseAuthError } from '../utils/authAdmin.js';

function GoogleLogoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3.01h3.87c2.26-2.08 3.56-5.15 3.56-8.66z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3.01c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28V6.62H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4 3.1C6.23 6.88 8.88 4.77 12 4.77z"
      />
    </svg>
  );
}

export default function AuthModal({
  open,
  initialMode = 'login',
  promptMessage = '',
  onClose,
  onSuccess,
  t
}) {
  const [mode, setMode] = useState(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setErrorMsg(promptMessage || '');
    }
  }, [open, initialMode, promptMessage]);

  if (!open) return null;

  const isSignUp = mode === 'signup';

  async function handleGoogleQuickSignIn() {
    if (submitting) return;
    setErrorMsg('');
    setSubmitting(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      onSuccess?.(cred.user);
      onClose?.();
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEmailSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const cleanEmail = email.trim();
    const cleanName = displayName.trim();

    if (!cleanEmail) {
      setErrorMsg(t.authErrInvalidEmail || 'يرجى إدخال البريد الإلكتروني.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg(t.authErrWeakPassword || 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
      return;
    }

    setErrorMsg('');
    setSubmitting(true);
    try {
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        if (cleanName) {
          await updateProfile(cred.user, { displayName: cleanName.slice(0, 100) }).catch(() => {});
        }
        await sendEmailVerification(cred.user).catch(() => {});
        onSuccess?.(cred.user);
        onClose?.();
      } else {
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
        onSuccess?.(cred.user);
        onClose?.();
      }
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose?.();
      }}
    >
      <div className="auth-dialog" data-testid="auth-modal">
        <div className="auth-header">
          <div className="auth-brand-row">
            <img src="/logo.png?v=6" alt="Plus AI" width="38" height="38" />
            <div>
              <h2 id="auth-modal-title">
                {isSignUp ? t.authSignupTitle : t.authLoginTitle}
              </h2>
              <p className="auth-subtitle">{t.authSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            className="auth-close"
            onClick={onClose}
            disabled={submitting}
            aria-label={t.authCloseAria}
          >
            ×
          </button>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!isSignUp}
            className={`auth-tab ${!isSignUp ? 'auth-tab-active' : ''}`}
            data-testid="auth-tab-login"
            onClick={() => {
              setMode('login');
              setErrorMsg('');
            }}
          >
            {t.authLoginTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignUp}
            className={`auth-tab ${isSignUp ? 'auth-tab-active' : ''}`}
            data-testid="auth-tab-signup"
            onClick={() => {
              setMode('signup');
              setErrorMsg('');
            }}
          >
            {t.authSignupTab}
          </button>
        </div>

        <button
          type="button"
          className="auth-google-btn"
          data-testid="google-quick-signin-btn"
          onClick={handleGoogleQuickSignIn}
          disabled={submitting}
        >
          <GoogleLogoIcon />
          <span>{t.authGoogleQuickButton}</span>
        </button>

        <div className="auth-divider">
          <span>{t.authOrDivider}</span>
        </div>

        <form className="auth-form" onSubmit={handleEmailSubmit}>
          {isSignUp && (
            <div className="auth-field">
              <label htmlFor="auth-display-name">{t.authNameLabel}</label>
              <input
                id="auth-display-name"
                type="text"
                maxLength={100}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t.authNamePlaceholder}
                autoComplete="name"
              />
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email">{t.authEmailLabel}</label>
            <input
              id="auth-email"
              type="email"
              maxLength={254}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
              dir="ltr"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">{t.authPasswordLabel}</label>
            <input
              id="auth-password"
              type="password"
              minLength={6}
              maxLength={128}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              dir="ltr"
            />
          </div>

          {errorMsg && (
            <div className="auth-error" role="alert" data-testid="auth-error-message">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            data-testid="auth-submit-btn"
            disabled={submitting}
          >
            {submitting
              ? t.authSubmitting
              : (isSignUp ? t.authCreateAccountButton : t.authLoginButton)}
          </button>
        </form>

        <p className="auth-benefit-note">{t.authDailyBenefitNote}</p>
      </div>
    </div>
  );
}
