import { useEffect, useRef, useState } from 'react';
import './pro-features.css';

const initialMessage = {
  id: 'welcome', role: 'assistant',
  content: 'أهلاً بك في ذكاء بلس | Zaka+، مساعدك الذكي. كيف يمكنني مساعدتك اليوم؟'
};
const STORAGE_KEY = 'zaka-plus-app-state-v2';
const models = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.8-flash-lite', label: 'Gemini 3.8 Flash Lite' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' }
];
const languages = [
  ['ar', 'العربية'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'],
  ['it', 'Italiano'], ['pt', 'Português'], ['hi', 'हिन्दी'], ['ur', 'اردو'], ['tr', 'Türkçe'],
  ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['ru', 'Русский'], ['id', 'Bahasa Indonesia'],
  ['bn', 'বাংলা'], ['fa', 'فارسی'], ['nl', 'Nederlands'], ['sv', 'Svenska'], ['pl', 'Polski']
];
const MAX_REQUEST_MESSAGES = 6;
const MAX_FILE_BYTES = 7 * 1024 * 1024;
const CLIENT_TIMEOUT_MS = 50000;
const suggestions = [
  { title: 'اكتب لي رسالة', detail: 'صياغة رسالة واضحة ومناسبة' },
  { title: 'اشرح لي موضوعاً', detail: 'شرح مبسّط خطوة بخطوة' },
  { title: 'ساعدني في فكرة', detail: 'عصف ذهني واقتراحات جديدة' }
];
const defaultSettings = {
  language: 'ar', darkMode: false, assistantName: 'ذكاء بلس', userName: '',
  accent: '#191919', fontSize: 14, notifications: false
};

function readSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      chats: Array.isArray(saved.chats) && saved.chats.length ? saved.chats : [{ id: 'chat-1', title: 'محادثة جديدة' }],
      messagesByChat: saved.messagesByChat && typeof saved.messagesByChat === 'object' ? saved.messagesByChat : { 'chat-1': [initialMessage] },
      settings: { ...defaultSettings, ...(saved.settings || {}) },
      selectedModel: models.some((item) => item.id === saved.selectedModel) ? saved.selectedModel : models[0].id
    };
  } catch {
    return { chats: [{ id: 'chat-1', title: 'محادثة جديدة' }], messagesByChat: { 'chat-1': [initialMessage] }, settings: defaultSettings, selectedModel: models[0].id };
  }
}

function saveableMessages(messages) {
  return messages.map((message) => ({
    ...message,
    attachments: Array.isArray(message.attachments) ? message.attachments.map(({ name, mimeType }) => ({ name, mimeType })) : []
  }));
}

function InlineMarkdown({ text }) {
  const pattern = /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s]+|\*\*[^*]+\*\*|`[^`]+`)/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (/^https?:\/\//.test(part)) return <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>;
    if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function Markdown({ text }) {
  return text.split('\n').map((line, index) => {
    if (/^###\s/.test(line)) return <h4 key={index}><InlineMarkdown text={line.slice(4)} /></h4>;
    if (/^##\s/.test(line)) return <h3 key={index}><InlineMarkdown text={line.slice(3)} /></h3>;
    if (/^#\s/.test(line)) return <h2 key={index}><InlineMarkdown text={line.slice(2)} /></h2>;
    if (/^[-*]\s/.test(line)) return <div className="markdown-list-item" key={index}><span aria-hidden="true">•</span><span><InlineMarkdown text={line.slice(2)} /></span></div>;
    if (/^\d+\.\s/.test(line)) return <div className="markdown-list-item" key={index}><span>{line.match(/^\d+/)[0]}.</span><span><InlineMarkdown text={line.replace(/^\d+\.\s/, '')} /></span></div>;
    return line ? <p key={index}><InlineMarkdown text={line} /></p> : <br key={index} />;
  });
}

function BrandMark({ small = false }) { return <span className={`brand-mark${small ? ' brand-mark-small' : ''}`}>Z+</span>; }
function NewChatIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>; }
function SendIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2.5-6.5L5 12Z" /><path d="m11.5 12.5 4-4" /></svg>; }
function CopyIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>; }

async function fileToData(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: الحد الأقصى لحجم الملف 7 ميغابايت.`);
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') throw new Error(`${file.name}: صيغة الملف غير مدعومة. اختر صورة أو PDF.`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mimeType: file.type, data: reader.result, preview: file.type.startsWith('image/') ? reader.result : '' });
    reader.onerror = () => reject(new Error(`تعذر قراءة الملف ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function getAssistantReply(conversation, model, uploads, flags, settings) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  const messages = conversation.filter((item) => item.id !== 'welcome' && !item.id.startsWith('error-')).slice(-MAX_REQUEST_MESSAGES).map(({ role, content }) => ({ role, content }));
  const systemInstruction = `You are ${settings.assistantName || 'Zaka+'}. Answer in ${languages.find(([code]) => code === settings.language)?.[1] || 'Arabic'} unless the user asks otherwise. ${settings.userName ? `Address the user as ${settings.userName} when natural.` : ''} Use clear Markdown and concise, well-organized answers.`;
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model, messages, attachments: uploads.map(({ name, mimeType, data }) => ({ name, mimeType, data })), searchEnabled: flags.search, thinkingEnabled: flags.thinking, systemInstruction })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `تعذر الاتصال بالمساعد (HTTP ${response.status}).`);
    if (typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('لم يصل رد نصي من النموذج. حاول مرة أخرى.');
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('انتهت مهلة الطلب. تحقق من الاتصال ثم أعد المحاولة.');
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export default function App() {
  const saved = useRef(readSavedState()).current;
  const [chats, setChats] = useState(saved.chats);
  const [activeChatId, setActiveChatId] = useState(saved.chats[0]?.id || 'chat-1');
  const [messagesByChat, setMessagesByChat] = useState(saved.messagesByChat);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [selectedModel, setSelectedModel] = useState(saved.selectedModel);
  const [settings, setSettings] = useState(saved.settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  const [renameId, setRenameId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const textareaRef = useRef(null);
  const bottomRef = useRef(null);
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);
  const filesRef = useRef(null);
  const requestIdRef = useRef(0);
  const messages = messagesByChat[activeChatId] || [initialMessage];
  const isEmptyChat = messages.length === 1 && messages[0].id === 'welcome';
  const selectedModelLabel = models.find((item) => item.id === selectedModel)?.label || models[0].label;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        chats, messagesByChat: Object.fromEntries(Object.entries(messagesByChat).map(([id, list]) => [id, saveableMessages(list)])),
        settings, selectedModel
      }));
    } catch { /* Storage can be full or disabled; chat remains usable for this session. */ }
  }, [chats, messagesByChat, settings, selectedModel]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, isLoading]);
  useEffect(() => {
    if (copiedId === null) return undefined;
    const timer = window.setTimeout(() => setCopiedId(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copiedId]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.darkMode ? 'dark' : 'light';
    document.documentElement.style.setProperty('--zaka-accent', settings.accent);
    document.documentElement.style.setProperty('--zaka-font-size', `${settings.fontSize}px`);
    document.documentElement.dir = settings.language === 'ar' || settings.language === 'fa' || settings.language === 'ur' ? 'rtl' : 'ltr';
  }, [settings]);

  function createNewChat() {
    const id = `chat-${Date.now()}`;
    setChats((current) => [{ id, title: 'محادثة جديدة' }, ...current]);
    setMessagesByChat((current) => ({ ...current, [id]: [initialMessage] }));
    setActiveChatId(id); setInput(''); setIsLoading(false); setSidebarOpen(false); setPendingFiles([]); requestIdRef.current += 1;
  }

  function selectChat(id) { setActiveChatId(id); setInput(''); setSidebarOpen(false); setIsLoading(false); setPendingFiles([]); requestIdRef.current += 1; }
  function updateSetting(key, value) { setSettings((current) => ({ ...current, [key]: value })); }

  async function addFiles(fileList) {
    setFileError('');
    const selected = Array.from(fileList || []);
    if (pendingFiles.length + selected.length > 4) { setFileError('يمكن إرفاق 4 ملفات كحد أقصى.'); return; }
    try {
      const converted = await Promise.all(selected.map(fileToData));
      setPendingFiles((current) => [...current, ...converted]);
      setAttachmentMenuOpen(false);
    } catch (error) { setFileError(error.message); }
  }

  async function sendConversation(conversation, uploads = [], model = selectedModel, flags = { search: searchEnabled, thinking: thinkingEnabled }) {
    return getAssistantReply(conversation, model, uploads, flags, settings);
  }

  async function handleSend(event) {
    event?.preventDefault();
    const text = input.trim();
    if ((!text && !pendingFiles.length) || isLoading) return;
    const chatId = activeChatId;
    const model = selectedModel;
    const files = pendingFiles;
    const userMessage = {
      id: `user-${Date.now()}`, role: 'user', content: text || 'يرجى تحليل المرفق.',
      attachments: files.map(({ name, mimeType, data, preview }) => ({ name, mimeType, data, preview }))
    };
    const updatedMessages = [...messages, userMessage];
    const requestId = ++requestIdRef.current;
    setMessagesByChat((current) => ({ ...current, [chatId]: updatedMessages }));
    setChats((current) => current.map((chat) => chat.id === chatId && chat.title === 'محادثة جديدة'
      ? { ...chat, title: (text || files[0]?.name || 'محادثة جديدة').slice(0, 34) }
      : chat));
    setInput(''); setPendingFiles([]); setIsLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const result = await sendConversation(updatedMessages, files, model);
      if (requestId !== requestIdRef.current) return;
      setMessagesByChat((current) => ({
        ...current,
        [chatId]: [...(current[chatId] || updatedMessages), {
          id: `assistant-${Date.now()}`, role: 'assistant', content: result.reply,
          sources: result.sources || [], model: result.model || model, rating: null
        }]
      }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setMessagesByChat((current) => ({ ...current, [chatId]: [...(current[chatId] || updatedMessages), { id: `error-${Date.now()}`, role: 'assistant', content: error?.message || 'تعذر الاتصال بالمساعد. حاول مرة أخرى.' }] }));
    } finally { if (requestId === requestIdRef.current) setIsLoading(false); }
  }

  async function regenerate(messageIndex) {
    if (isLoading) return;
    const history = messages.filter((item) => item.id !== 'welcome' && !item.id.startsWith('error-')).slice(0, messageIndex).filter((item) => item.role !== 'assistant' || !item.id.startsWith('assistant-'));
    if (!history.length) return;
    const targetUser = [...history].reverse().find((item) => item.role === 'user');
    const uploads = (targetUser?.attachments || []).filter((item) => item.data).map((item) => ({ name: item.name, mimeType: item.mimeType, data: item.data }));
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const result = await sendConversation(history, uploads, selectedModel);
      if (requestId !== requestIdRef.current) return;
      setMessagesByChat((current) => ({ ...current, [activeChatId]: [...history, { id: `assistant-${Date.now()}`, role: 'assistant', content: result.reply, sources: result.sources || [], model: result.model || selectedModel, rating: null }] }));
    } catch (error) {
      if (requestId === requestIdRef.current) setMessagesByChat((current) => ({ ...current, [activeChatId]: [...history, { id: `error-${Date.now()}`, role: 'assistant', content: error.message || 'تعذر إعادة إنشاء الرد.' }] }));
    } finally { if (requestId === requestIdRef.current) setIsLoading(false); }
  }

  function setRating(messageId, rating) {
    setMessagesByChat((current) => ({ ...current, [activeChatId]: (current[activeChatId] || []).map((item) => item.id === messageId ? { ...item, rating: item.rating === rating ? null : rating } : item) }));
  }
  async function copyMessage(message) { try { await navigator.clipboard.writeText(message.content); setCopiedId(message.id); } catch { setCopiedId(null); } }
  async function shareMessage(message) {
    try {
      if (navigator.share) await navigator.share({ title: settings.assistantName || 'Zaka+', text: message.content });
      else await navigator.clipboard.writeText(message.content);
    } catch { /* User cancelled share. */ }
  }
  function renameChat(chat) {
    const title = renameValue.trim();
    if (title) setChats((current) => current.map((item) => item.id === chat.id ? { ...item, title } : item));
    setRenameId(null);
  }
  function deleteChat(chatId) {
    const remaining = chats.filter((chat) => chat.id !== chatId);
    const nextChats = remaining.length ? remaining : [{ id: `chat-${Date.now()}`, title: 'محادثة جديدة' }];
    setChats(nextChats);
    setMessagesByChat((current) => {
      const next = { ...current }; delete next[chatId];
      if (!remaining.length) next[nextChats[0].id] = [initialMessage];
      return next;
    });
    if (activeChatId === chatId) setActiveChatId(nextChats[0].id);
  }
  function clearHistory() {
    const chat = { id: `chat-${Date.now()}`, title: 'محادثة جديدة' };
    setChats([chat]); setMessagesByChat({ [chat.id]: [initialMessage] }); setActiveChatId(chat.id);
  }
  function handleInputChange(event) {
    setInput(event.target.value); event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
  }
  function handleFilesFromInput(event) { addFiles(event.target.files); event.target.value = ''; }

  return (
    <div className={`app-shell${settings.darkMode ? ' app-dark' : ''}`} dir={settings.language === 'ar' || settings.language === 'fa' || settings.language === 'ur' ? 'rtl' : 'ltr'}>
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-top">
          <a className="brand" href="#home" onClick={(event) => event.preventDefault()}><BrandMark /><span className="brand-name">ذكاء بلس</span></a>
          <button className="icon-button mobile-close" type="button" aria-label="إغلاق القائمة" onClick={() => setSidebarOpen(false)}>×</button>
          <button className="icon-button desktop-toggle" type="button" aria-label="بدء محادثة جديدة" onClick={createNewChat}><NewChatIcon /></button>
        </div>
        <button className="new-chat-button" type="button" onClick={createNewChat}><NewChatIcon /><span>محادثة جديدة</span></button>
        <div className="history-heading">المحادثات</div>
        <nav className="chat-history" aria-label="المحادثات السابقة">
          {chats.map((chat) => <div className={`history-row${chat.id === activeChatId ? ' history-item-active' : ''}`} key={chat.id}>
            {renameId === chat.id ? <form className="rename-form" onSubmit={(event) => { event.preventDefault(); renameChat(chat); }}><input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus /><button type="submit" aria-label="حفظ الاسم">✓</button></form> : <button className="history-item" type="button" title={chat.title} onClick={() => selectChat(chat.id)} onDoubleClick={() => { setRenameId(chat.id); setRenameValue(chat.title); }}><span className="history-bubble" /><span>{chat.title}</span></button>}
            <button className="chat-action" type="button" title="إعادة تسمية" aria-label="إعادة تسمية المحادثة" onClick={() => { setRenameId(chat.id); setRenameValue(chat.title); }}>✎</button>
            <button className="chat-action" type="button" title="حذف" aria-label="حذف المحادثة" onClick={() => deleteChat(chat.id)}>×</button>
          </div>)}
        </nav>
        <div className="sidebar-footer"><BrandMark small /><div className="footer-copy"><div className="footer-title">{settings.assistantName || 'ذكاء بلس'} | Zaka+</div><div className="footer-caption">محادثاتك محفوظة على هذا الجهاز</div></div><button className="icon-button settings-button" type="button" aria-label="الإعدادات" onClick={() => setSettingsOpen(true)}>⚙️</button></div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" type="button" aria-label="إغلاق القائمة" onClick={() => setSidebarOpen(false)} />}

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu" type="button" aria-label="فتح قائمة المحادثات" onClick={() => setSidebarOpen(true)}>☰</button>
          <div className="model-selector"><span>ذكاء بلس</span><select className="model-version" aria-label="اختيار نموذج الذكاء الاصطناعي" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={isLoading}>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></div>
          <div className="topbar-spacer" /><span className="topbar-status"><span className="status-dot" /> جاهز</span>
        </header>

        <section className={`conversation${isEmptyChat ? ' conversation-empty' : ''}`} aria-label="المحادثة">
          {isEmptyChat ? <div className="welcome-panel"><div className="welcome-mark"><BrandMark /></div><h1>كيف أقدر أساعدك؟</h1><p>اسأل، اكتب، أو ابدأ بفكرة — وأنا أساعدك في الخطوة التالية.</p><div className="suggestion-grid">{suggestions.map((suggestion) => <button className="suggestion-card" key={suggestion.title} type="button" onClick={() => { setInput(suggestion.title); textareaRef.current?.focus(); }}><span className="suggestion-title">{suggestion.title}</span><span className="suggestion-detail">{suggestion.detail}</span></button>)}</div></div> : <div className="message-list">
            {messages.filter((message) => message.id !== 'welcome').map((message, index) => <article className={`message message-${message.role}`} key={message.id}>
              {message.role === 'assistant' && <BrandMark small />}
              <div className="message-body">
                {message.role === 'assistant' && <div className="message-author">{settings.assistantName || 'ذكاء بلس'}{message.model && <small className="response-model">{message.model}</small>}</div>}
                {message.role === 'user' && message.attachments?.length > 0 && <div className="message-attachments">{message.attachments.map((file, i) => file.preview ? <img key={i} src={file.preview} alt={file.name} /> : <span className="file-chip" key={i}>📄 {file.name}</span>)}</div>}
                <div className="message-content markdown-content"><Markdown text={message.content} /></div>
                {message.sources?.length > 0 && <div className="source-list"><strong>المصادر</strong>{message.sources.map((source) => <a href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div>}
                {message.role === 'assistant' && !message.id.startsWith('error-') && <div className="message-actions">
                  <button className="copy-button" type="button" onClick={() => copyMessage(message)} aria-label="نسخ الرد"><CopyIcon /><span>{copiedId === message.id ? 'تم النسخ' : 'نسخ'}</span></button>
                  <button className="copy-button" type="button" onClick={() => shareMessage(message)} aria-label="مشاركة الرد">مشاركة</button>
                  <button className={`copy-button${message.rating === 'up' ? ' rated' : ''}`} type="button" onClick={() => setRating(message.id, 'up')} aria-label="إجابة مفيدة">👍</button>
                  <button className={`copy-button${message.rating === 'down' ? ' rated' : ''}`} type="button" onClick={() => setRating(message.id, 'down')} aria-label="إجابة غير مفيدة">👎</button>
                  <button className="copy-button" type="button" onClick={() => regenerate(index)} aria-label="إعادة توليد الإجابة">إعادة الإجابة</button>
                </div>}
              </div>
            </article>)}
            {isLoading && <article className="message message-assistant" aria-label={thinkingEnabled ? 'المساعد يفكر ويكتب' : 'المساعد يكتب'}><BrandMark small /><div className="message-body"><div className="message-author">{settings.assistantName || 'ذكاء بلس'}{thinkingEnabled && <span className="thinking-label">يفكر بعمق…</span>}</div><div className="typing-indicator"><i /><i /><i /></div></div></article>}
            <div ref={bottomRef} />
          </div>}
        </section>

        <div className="composer-area">
          <div className="mode-buttons"><button type="button" className={`mode-button${searchEnabled ? ' mode-active' : ''}`} aria-pressed={searchEnabled} onClick={() => setSearchEnabled((value) => !value)}>⌕ البحث {searchEnabled && <span>مفعّل</span>}</button><button type="button" className={`mode-button${thinkingEnabled ? ' mode-active' : ''}`} aria-pressed={thinkingEnabled} onClick={() => setThinkingEnabled((value) => !value)}>✧ التفكير {thinkingEnabled && <span>مفعّل</span>}</button></div>
          {pendingFiles.length > 0 && <div className="attachment-previews">{pendingFiles.map((file, index) => <div className="attachment-preview" key={`${file.name}-${index}`}>{file.preview ? <img src={file.preview} alt={file.name} /> : <span className="pdf-preview">PDF</span>}<span title={file.name}>{file.name}</span><button type="button" aria-label={`حذف ${file.name}`} onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== index))}>×</button></div>)}</div>}
          {fileError && <p className="file-error" role="alert">{fileError}</p>}
          <form className="composer" onSubmit={handleSend}>
            <div className="attachment-control"><button className="add-button" type="button" aria-label="إضافة مرفق" aria-expanded={attachmentMenuOpen} onClick={() => setAttachmentMenuOpen((value) => !value)}>＋</button>{attachmentMenuOpen && <div className="attachment-menu"><button type="button" onClick={() => cameraRef.current?.click()}>📷 الكاميرا</button><button type="button" onClick={() => galleryRef.current?.click()}>🖼️ الصور</button><button type="button" onClick={() => filesRef.current?.click()}>📎 الملفات وPDF</button></div>}</div>
            <input ref={cameraRef} className="hidden-file-input" type="file" accept="image/*" capture="environment" onChange={handleFilesFromInput} />
            <input ref={galleryRef} className="hidden-file-input" type="file" accept="image/*" multiple onChange={handleFilesFromInput} />
            <input ref={filesRef} className="hidden-file-input" type="file" accept="image/*,application/pdf" multiple onChange={handleFilesFromInput} />
            <textarea ref={textareaRef} rows={1} value={input} onChange={handleInputChange} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(event); } }} placeholder="اكتب رسالتك إلى ذكاء بلس..." aria-label="رسالتك" disabled={isLoading} />
            <button className="send-button" type="submit" disabled={(!input.trim() && !pendingFiles.length) || isLoading} aria-label="إرسال الرسالة"><SendIcon /></button>
          </form>
          <p className="disclaimer">قد ينتج {selectedModelLabel} إجابات غير دقيقة؛ تحقّق من المعلومات المهمة.</p>
        </div>
      </main>

      {settingsOpen && <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><h2 id="settings-title">إعدادات Zaka+</h2><button type="button" aria-label="إغلاق الإعدادات" onClick={() => setSettingsOpen(false)}>×</button></header>
        <label>لغة الواجهة والرد<select value={settings.language} onChange={(event) => updateSetting('language', event.target.value)}>{languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
        <label className="settings-toggle">الوضع الليلي<input type="checkbox" checked={settings.darkMode} onChange={(event) => updateSetting('darkMode', event.target.checked)} /></label>
        <label>اسم المساعد<input value={settings.assistantName} maxLength={32} onChange={(event) => updateSetting('assistantName', event.target.value)} /></label>
        <label>اسمك المفضل<input value={settings.userName} maxLength={32} onChange={(event) => updateSetting('userName', event.target.value)} placeholder="اختياري" /></label>
        <label>لون الواجهة<input type="color" value={settings.accent} onChange={(event) => updateSetting('accent', event.target.value)} /></label>
        <label>حجم الخط <span>{settings.fontSize}px</span><input type="range" min="12" max="20" value={settings.fontSize} onChange={(event) => updateSetting('fontSize', Number(event.target.value))} /></label>
        <label className="settings-toggle">الإشعارات<input type="checkbox" checked={settings.notifications} onChange={async (event) => { const enabled = event.target.checked; if (enabled && 'Notification' in window) { const permission = await Notification.requestPermission(); updateSetting('notifications', permission === 'granted'); } else updateSetting('notifications', false); }} /></label>
        <div className="privacy-note"><strong>الخصوصية</strong><p>تُحفظ المحادثات والإعدادات محلياً في هذا المتصفح. تُرسل الرسائل والمرفقات إلى Google Gemini لمعالجتها. لا تُخزن مفاتيح API في الواجهة.</p></div>
        <button className="clear-history-button" type="button" onClick={() => { if (window.confirm('هل تريد مسح سجل المحادثات المحفوظ على هذا الجهاز؟')) clearHistory(); }}>مسح سجل المحادثات</button>
        <div className="about-card"><strong>إدارة الحساب</strong><p>لا يوجد تسجيل دخول أو حساب مرتبط حالياً.</p><strong>عن التطبيق</strong><p>ذكاء بلس | Zaka+ — مساعد ذكي عربي.</p></div>
      </section></div>}
    </div>
  );
}
