import React, { useEffect, useState } from 'react';

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

function DownloadIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3" /></svg>;
}

export default function PwaInstall() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setMessage('تم تثبيت التطبيق بنجاح.');
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

  async function installApp() {
    if (isStandalone()) {
      setInstalled(true);
      setMessage('التطبيق مثبت بالفعل.');
      return;
    }
    if (isIosDevice()) {
      setMessage('للتثبيت على الآيفون، اضغط على زر المشاركة في المتصفح واختر (إضافة إلى الشاشة الرئيسية)');
      return;
    }
    if (!installPrompt) {
      setMessage('التثبيت غير متاح حالياً. استخدم قائمة المتصفح واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».');
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setMessage(choice?.outcome === 'accepted' ? 'جارٍ تثبيت التطبيق…' : 'يمكنك تثبيت التطبيق لاحقاً من هذا الزر.');
  }

  return <div className="pwa-install-widget">
    {installed
      ? <div className="pwa-installed" role="status">✓ التطبيق مثبت بالفعل</div>
      : <button className="pwa-install-button" type="button" onClick={installApp}><DownloadIcon/><span>تثبيت التطبيق</span></button>}
    {message && <p className="pwa-install-message" role="status">{message}</p>}
  </div>;
}
