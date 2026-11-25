import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import PwaInstall from './PwaInstall.jsx';
import './styles.css';
import './app-enhancements.css';
import './logo-image.css';
import './pwa.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

function installSidebarEnhancements() {
  try {
    const sidebar = document.querySelector('.chat-sidebar');
    if (!sidebar) return;

    if (!sidebar.querySelector('.pwa-install-mount')) {
      const installMount = document.createElement('div');
      installMount.className = 'pwa-install-mount';
      const footer = sidebar.querySelector('.sidebar-footer');
      sidebar.insertBefore(installMount, footer || null);
      ReactDOM.createRoot(installMount).render(<PwaInstall />);
    }
  } catch {
    // Ignore optional sidebar enhancement errors to keep core UI running.
  }
}

if (typeof document !== 'undefined' && document.body && typeof MutationObserver !== 'undefined') {
  const sidebarObserver = new MutationObserver(installSidebarEnhancements);
  sidebarObserver.observe(document.body, { childList: true, subtree: true });
  installSidebarEnhancements();
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=11')
      .then((reg) => reg.update().catch(() => {}))
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });
}
