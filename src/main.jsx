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
      const nextTitle = window.prompt('اكتب الاسم الجديد للمحادثة:', title.textContent)?.trim();
      if (!nextTitle) return;
      try {
        const storageKey = 'zaka-plus-chat-v5';
        const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
        const chats = Array.isArray(saved.chats) ? saved.chats : [];
        const chat = chats.find((item) => item.id === entry.querySelector('.history-select')?.getAttribute('data-chat-id'));
        const matchingChat = chat || chats.find((item) => item.title === title.textContent);
        if (!matchingChat) return;
        matchingChat.title = nextTitle.slice(0, 80);
        localStorage.setItem(storageKey, JSON.stringify({ ...saved, chats }));
        window.location.reload();
      } catch {
        window.alert('تعذرت إعادة تسمية المحادثة.');
      }
    });
    entry.append(rename);
  });
}

const sidebarObserver = new MutationObserver(installSidebarEnhancements);
sidebarObserver.observe(document.body, { childList: true, subtree: true });
installSidebarEnhancements();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=4').catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}
