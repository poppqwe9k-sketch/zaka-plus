import React, { useEffect, useState } from 'react';

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

const PWA_LABELS = {
  ar: {
    install: 'تثبيت التطبيق',
    installed: '✓ التطبيق مثبت بالفعل',
    installedToast: 'تم تثبيت التطبيق بنجاح.',
    iosHint: 'للتثبيت على الآيفون، اضغط على زر المشاركة في المتصفح واختر (إضافة إلى الشاشة الرئيسية)',
    unavailable: 'التثبيت غير متاح حالياً. استخدم قائمة المتصفح واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».',
    installing: 'جارٍ تثبيت التطبيق…',
    later: 'يمكنك تثبيت التطبيق لاحقاً من هذا الزر.'
  },
  en: {
    install: 'Install App',
    installed: '✓ App already installed',
    installedToast: 'App installed successfully.',
    iosHint: 'To install on iPhone, tap Share in your browser and choose "Add to Home Screen".',
    unavailable: 'Install is unavailable here. Use your browser menu and choose "Install App" or "Add to Home Screen".',
    installing: 'Installing app…',
    later: 'You can install the app later from this button.'
  }
};

function DownloadIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3" /></svg>;
}

export default function PwaInstall() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [message, setMessage] = useState('');
  const [lang, setLang] = useState(() => document.documentElement.lang || 'ar');

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setLang(document.documentElement.lang || 'ar');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setMessage((PWA_LABELS[document.documentElement.lang] || PWA_LABELS.en).installedToast);
    };
    const displayMode = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayModeChange = () => setInstalled(isStandalone());

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    displayMode?.addEventListener?.('change', onDisplayModeChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      displayMode?.removeEventListener?.('change', onDisplayModeChange);
    };
  }, []);

  const labels = PWA_LABELS[lang] || (lang === 'fa' || lang === 'ur' ? PWA_LABELS.ar : PWA_LABELS.en);

  async function installApp() {
    if (isStandalone()) {
      setInstalled(true);
      setMessage(labels.installed);
      return;
    }
    if (isIosDevice()) {
      setMessage(labels.iosHint);
      return;
    }
    if (!installPrompt) {
      setMessage(labels.unavailable);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setMessage(choice?.outcome === 'accepted' ? labels.installing : labels.later);
  }

  return (
    <div className="pwa-install-widget">
      {installed
        ? <div className="pwa-installed" role="status">{labels.installed}</div>
        : <button className="pwa-install-button" type="button" onClick={installApp}><DownloadIcon /><span>{labels.install}</span></button>}
      {message && <p className="pwa-install-message" role="status">{message}</p>}
    </div>
  );
}
