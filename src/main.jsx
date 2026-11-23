import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import PwaInstall from './PwaInstall.jsx';
import './styles.css';
import './app-enhancements.css';
import './logo-image.css';
import './pwa.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function installSidebarEnhancements() {
  const sidebar = document.querySelector('.chat-sidebar');
  const history = sidebar?.querySelector('.chat-history');
  if (!sidebar || !history) return;

  let installMount = sidebar.querySelector('.pwa-install-mount');
  if (!installMount) {
    installMount = document.createElement('div');
    installMount.className = 'pwa-install-mount';
    const footer = sidebar.querySelector('.sidebar-footer');
    sidebar.insertBefore(installMount, footer || null);
    ReactDOM.createRoot(installMount).render(<PwaInstall />);
  }

  history.querySelectorAll('.history-entry').forEach((entry) => {
    if (entry.querySelector('.history-rename')) return;
    const select = entry.querySelector('.history-select');
    const title = entry.querySelector('.history-text');
    if (!select || !title) return;

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'history-rename';
    rename.setAttribute('aria-label', `إعادة تسمية ${title.textContent}`);
    rename.title = 'إعادة تسمية المحادثة';
    rename.textContent = '✎';
    rename.addEventListener('click', (event) => {
      event.stopPropagation();
      if (entry.querySelector('.history-rename-input')) return;
      const currentTitle = title.textContent || '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentTitle;
      input.maxLength = 80;
      input.className = 'history-rename-input';
      input.style.cssText = 'flex:1;min-width:0;font:inherit;font-size:13px;padding:2px 6px;border-radius:6px;border:1px solid currentColor;background:transparent;color:inherit;';

      let settled = false;
      const cleanup = () => {
        if (settled) return false;
        settled = true;
        if (input.isConnected) input.remove();
        select.style.display = '';
        return true;
      };

      const commitRename = () => {
        const nextTitle = input.value.trim();
        if (!cleanup()) return;
        if (!nextTitle || nextTitle === currentTitle) return;
        const safeTitle = nextTitle.slice(0, 80);
        const chatId = entry.querySelector('.history-select')?.getAttribute('data-chat-id') || '';
        window.dispatchEvent(new CustomEvent('zaka-chat-rename', {
          detail: { chatId, previousTitle: currentTitle, title: safeTitle }
        }));
      };

      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitRename();
        } else if (e.key === 'Escape') {
          cleanup();
        }
      });
      input.addEventListener('blur', commitRename, { once: true });

      select.style.display = 'none';
      entry.insertBefore(input, rename);
      input.focus();
      input.select();
    });
    entry.append(rename);
  });
}

const sidebarObserver = new MutationObserver(installSidebarEnhancements);
sidebarObserver.observe(document.body, { childList: true, subtree: true });
installSidebarEnhancements();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=7')
      .then((reg) => reg.update().catch(() => {}))
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });
}
