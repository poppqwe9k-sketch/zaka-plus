import { useCallback, useEffect, useRef, useState } from 'react';
import './chat-redesign.css';
import './settings.css';
import './chat-features.css';

const MODEL_ID = 'gemini-3.1-flash-lite';
const MODEL_NAME = 'Gemini 3.1 Flash Lite';
const STORAGE_KEY = 'zaka-plus-chat-v5';
const MAX_FILE_BYTES = 7 * 1024 * 1024;
const IMAGE_SERVICE = 'https://image.pollinations.ai/prompt/';
const DEFAULT_SETTINGS = { theme: 'system', lang: 'ar', customInstructions: '', memory: true, improveModel: true };
const SUGGESTIONS = [
  { icon: '💡', text: 'اشرح لي مفهوماً معقداً ببساطة' },
  { icon: '💻', text: 'اكتب لي كود موقع ويب' },
  { icon: '✍️', text: 'لخص لي نصاً طويلاً' },
  { icon: '🎨', text: 'ارسم لي صورة إبداعية' },
];

function newChat() {
  return { id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: 'محادثة جديدة', messages: [], updatedAt: Date.now() };
}

function loadAppState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const chats = Array.isArray(saved.chats) ? saved.chats.map((chat) => ({ ...chat, messages: Array.isArray(chat.messages) ? chat.messages : [] })) : [];
    const list = chats.length ? chats : [newChat()];
    let settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    try {
      const legacySettings = JSON.parse(localStorage.getItem('ai_app_settings') || '{}');
      settings = { ...settings, ...legacySettings };
    } catch { /* Ignore malformed legacy settings. */ }
    return { chats: list, activeChatId: list.some((chat) => chat.id === saved.activeChatId) ? saved.activeChatId : list[0].id, settings };
  } catch {
    const chat = newChat();
    return { chats: [chat], activeChatId: chat.id, settings: DEFAULT_SETTINGS };
  }
}

function Logo({ size = 34, className = '' }) {
  return <img src="/logo.svg" width={size} height={size} className={className} alt="شعار ذكاء بلس" />;
}

function Icon({ children, viewBox = '0 0 24 24' }) {
  return <svg viewBox={viewBox} aria-hidden="true">{children}</svg>;
}

function SettingsIcon() { return <Icon><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.1.9-1.1 1.9-1.4-.5a7.8 7.8 0 0 1-1.5.9l-.2 1.5h-2.2l-.3-1.5a7.8 7.8 0 0 1-1.6-.6l-1.3.8-1.6-1.6.8-1.3a7.8 7.8 0 0 1-.6-1.6l-1.5-.3v-2.2l1.5-.2a7.8 7.8 0 0 1 .9-1.5l-.5-1.4 1.9-1.1.9 1.1.1.1a7.8 7.8 0 0 1 1.7-.7l.3-1.5h2.2l.2 1.5a7.8 7.8 0 0 1 1.7.7Z"/><circle cx="12" cy="12" r="2"/></Icon>; }
function MenuIcon() { return <Icon><path d="M4 6h16M4 12h16M4 18h16"/></Icon>; }
function PlusIcon() { return <Icon><path d="M12 5v14M5 12h14"/></Icon>; }
function SunIcon() { return <Icon><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></Icon>; }
function MoonIcon() { return <Icon><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.6 8.6 0 1 0 20.2 15.4Z"/></Icon>; }
function MicIcon() { return <Icon><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/></Icon>; }
function CopyIcon() { return <Icon><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></Icon>; }
function SpeakerIcon() { return <Icon><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/></Icon>; }
function ShareIcon() { return <Icon><path d="M12 16V3m-5 5 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></Icon>; }
function RetryIcon() { return <Icon><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3"/></Icon>; }
function ImageIcon() { return <Icon><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></Icon>; }

function formatTitle(text, files) {
  const title = text.trim() || files[0]?.name || 'محادثة جديدة';
  return title.length > 38 ? `${title.slice(0, 38)}…` : title;
}

function detectImageRequest(text) {
  return /(?:ارسم|ارسملي|ارسم لي|صمم صورة|صورة(?: لي)?|ولد صورة|أنشئ صورة|انشئ صورة|توليد صورة|generate\s+(?:an?\s+)?image|create\s+(?:an?\s+)?image)/i.test(text);
}

function imageUrlForPrompt(prompt) {
  return `${IMAGE_SERVICE}${encodeURIComponent(prompt.trim())}?width=1024&height=1024&nologo=true`;
}

function sourceDocument(code, language) {
  const safeCode = code.replace(/<\/script/gi, '<\\/script');
  const csp = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;";
  if (language === 'css') return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{font-family:system-ui;padding:24px}${safeCode}</style><h2>معاينة CSS</h2>`;
  if (language === 'javascript' || language === 'js') return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><div id="app"></div><script>${safeCode}<\/script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${safeCode}</body></html>`;
}

function MessageContent({ content, onPreview }) {
  const blocks = [];
  const pattern = /```([\w-]*)\s*\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(content))) {
    if (match.index > cursor) blocks.push({ type: 'text', value: content.slice(cursor, match.index) });
    blocks.push({ type: 'code', language: match[1].toLowerCase(), value: match[2].replace(/\n$/, '') });
    cursor = pattern.lastIndex;
  }
  if (cursor < content.length) blocks.push({ type: 'text', value: content.slice(cursor) });

  return <div className="rich-message-content">{blocks.map((block, index) => {
    if (block.type === 'text') return block.value ? <p className="plain-message-text" key={`text-${index}`}>{block.value}</p> : null;
    const previewable = ['html', 'htm', 'css', 'js', 'javascript'].includes(block.language);
    return <div className="code-block" key={`code-${index}`}>
      <div className="code-toolbar"><span>{block.language || 'code'}</span><div>
        <button type="button" className="code-action" onClick={() => navigator.clipboard?.writeText(block.value).catch(() => {})}><CopyIcon/> نسخ</button>
        {previewable && <button type="button" className="code-action" onClick={() => onPreview({ title: `معاينة ${block.language.toUpperCase()}`, srcDoc: sourceDocument(block.value, block.language) })}>معاينة</button>}
      </div></div>
      <pre><code>{block.value}</code></pre>
    </div>;
  })}</div>;
}

function SettingsModal({ settings, onChange, onClose, onClearChats }) {
  useEffect(() => {
    function onKeyDown(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog" role="dialog" aria-modal="true" dir="rtl">
      <header className="settings-header"><h2>الإعدادات</h2><button className="settings-close" type="button" aria-label="إغلاق الإعدادات" onClick={onClose}>×</button></header>
      <div className="settings-body">
        <section className="settings-section"><h3>عام</h3>
          <label className="settings-row" htmlFor="themeSelect"><span>المظهر</span><select id="themeSelect" value={settings.theme} onChange={(event) => onChange('theme', event.target.value)}><option value="system">النظام</option><option value="light">فاتح</option><option value="dark">داكن</option></select></label>
          <label className="settings-row" htmlFor="langSelect"><span>لغة الرد</span><select id="langSelect" value={settings.lang} onChange={(event) => onChange('lang', event.target.value)}><option value="ar">العربية</option><option value="en">English</option></select></label>
        </section>
        <section className="settings-section"><h3>التخصيص</h3>
          <label className="settings-column" htmlFor="customInstructions"><span>التعليمات المخصصة</span><small>كيف تريد أن يرد عليك المساعد؟</small><textarea id="customInstructions" rows="4" value={settings.customInstructions} onChange={(event) => onChange('customInstructions', event.target.value)} /></label>
          <div className="settings-row"><div><div className="settings-item-title">الذاكرة</div><small>استخدم رسائل المحادثة الحالية كسياق للإجابة</small></div><button type="button" className={`settings-toggle${settings.memory ? ' settings-toggle-active' : ''}`} aria-label="تبديل الذاكرة" aria-pressed={settings.memory} onClick={() => onChange('memory', !settings.memory)}><span/></button></div>
        </section>
        <section className="settings-section"><h3>التحكم بالبيانات</h3>
          <div className="settings-row"><div><div className="settings-item-title">تحسين النموذج للجميع</div><small>تفضيل محفوظ محلياً؛ لا يغيّر طريقة المعالجة</small></div><button type="button" className={`settings-toggle${settings.improveModel ? ' settings-toggle-active' : ''}`} aria-label="تبديل تحسين النموذج" aria-pressed={settings.improveModel} onClick={() => onChange('improveModel', !settings.improveModel)}><span/></button></div>
          <div className="settings-row"><span>سجل المحادثات</span><button className="settings-danger" type="button" onClick={onClearChats}>مسح الكل</button></div>
        </section>
        <section className="settings-section settings-about"><h3>حول التطبيق</h3><div className="settings-row"><span>الإصدار</span><span className="settings-version">v1.0.0</span></div></section>
      </div>
    </section>
  </div>;
}

function PreviewModal({ preview, onClose }) {
  useEffect(() => {
    function onKeyDown(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className="preview-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="preview-dialog" role="dialog" aria-modal="true" aria-label={preview.title}>
      <header className="preview-header"><strong>{preview.title}</strong><button type="button" className="settings-close" onClick={onClose} aria-label="إغلاق المعاينة">×</button></header>
      <iframe title={preview.title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview.srcDoc}/>
    </section>
  </div>;
}

export default function App() {
  const initial = useRef(loadAppState()).current;
  const [chats, setChats] = useState(initial.chats);
  const [activeChatId, setActiveChatId] = useState(initial.activeChatId);
  const [settings, setSettings] = useState(initial.settings);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deepThinking, setDeepThinking] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [imageMode, setImageMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [preview, setPreview] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [speakingId, setSpeakingId] = useState(null);
  const [imageLoadingId, setImageLoadingId] = useState(null);
  const bottomRef = useRef(null);
  const menuRef = useRef(null);
  const imageInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const activeChat = chats.find((chat) => chat.id === activeChatId) || chats[0];
  const messages = activeChat?.messages || [];
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const darkMode = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);

  useEffect(() => {
    try {
      const safeChats = chats.map((chat) => ({ ...chat, messages: chat.messages.map(({ role, content, imageUrl, imagePrompt, attachments: files = [] }) => ({ role, content, imageUrl, imagePrompt, attachments: files })) }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats: safeChats, activeChatId, settings }));
      localStorage.setItem('ai_app_settings', JSON.stringify(settings));
    } catch { /* Chat remains available if storage is unavailable or full. */ }
  }, [chats, activeChatId, settings]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const update = (event) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, loading]);

  function updateSetting(key, value) { setSettings((current) => ({ ...current, [key]: value })); }
  function updateChat(chatId, updater) { setChats((current) => current.map((chat) => chat.id === chatId ? updater(chat) : chat)); }
  function createNewChat() {
    const chat = newChat(); setChats((current) => [chat, ...current]); setActiveChatId(chat.id);
    setInput(''); setAttachments([]); setError(''); setDeepThinking(false); setImageMode(false); setLoading(false); setSidebarOpen(false);
  }
  function selectChat(chatId) { setActiveChatId(chatId); setInput(''); setAttachments([]); setError(''); setLoading(false); setSidebarOpen(false); }
  function removeChat(chatId, event) {
    event.stopPropagation();
    const remaining = chats.filter((chat) => chat.id !== chatId);
    const nextChats = remaining.length ? remaining : [newChat()];
    setChats(nextChats); if (activeChatId === chatId) setActiveChatId(nextChats[0].id);
  }
  function clearAllChats() {
    if (!window.confirm('هل أنت متأكد من حذف جميع المحادثات؟ لا يمكن التراجع عن هذه الخطوة.')) return;
    const chat = newChat(); setChats([chat]); setActiveChatId(chat.id); setInput(''); setAttachments([]); setError(''); setLoading(false); setSettingsOpen(false);
  }

  async function addFiles(fileList) {
    const selected = Array.from(fileList || []);
    if (!selected.length) return;
    setError('');
    if (attachments.length + selected.length > 4) { setError('يمكن إرفاق 4 ملفات كحد أقصى.'); return; }
    try {
      const loaded = await Promise.all(selected.map((file) => {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: الحد الأقصى لحجم الملف 7 ميغابايت.`);
        const isImage = file.type.startsWith('image/'); const isPdf = file.type === 'application/pdf';
        if (!isImage && !isPdf) throw new Error('الصيغ المدعومة هي الصور وملفات PDF فقط.');
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, mimeType: file.type, data: reader.result, kind: isImage ? 'image' : 'pdf', preview: isImage ? reader.result : '' });
          reader.onerror = () => reject(new Error(`تعذرت قراءة الملف ${file.name}.`));
          reader.readAsDataURL(file);
        });
      }));
      setAttachments((current) => [...current, ...loaded]);
    } catch (fileError) { setError(fileError instanceof Error ? fileError.message : 'تعذرت قراءة الملف.'); }
  }

  async function requestAssistant({ chatId, baseMessages, userMessage, files = [], imageGeneration = false }) {
    setLoading(true); setError('');
    const customInstructions = settings.customInstructions.trim();
    const languageName = settings.lang === 'en' ? 'English' : 'Arabic';
    const regular = `أنت مساعد ذكاء بلس | Zaka+. أجب بوضوح ودقة وباللغة ${languageName} ما لم يطلب المستخدم غير ذلك.`;
    const deep = deepThinking ? 'قدّم تحليلاً متأنياً وإجابة مفصلة ومنظمة، مع بيان الافتراضات وعدم اليقين.' : '';
    const systemInstruction = [regular, customInstructions ? `تعليمات المستخدم المخصصة: ${customInstructions}` : '', deep].filter(Boolean).join('\n\n');
    const contextMessages = settings.memory ? baseMessages.slice(-10) : [userMessage];
    try {
      if (imageGeneration) {
        const url = imageUrlForPrompt(userMessage.content);
        const imageReply = { role: 'assistant', content: 'تفضل، هذه الصورة التي تم توليدها حسب وصفك.', imageUrl: url, imagePrompt: userMessage.content };
        updateChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, imageReply], updatedAt: Date.now() }));
        return;
      }
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL_ID, selectedModel, messages: contextMessages.map(({ role, content }) => ({ role, content })), attachments: files.map(({ mimeType, data }) => ({ mimeType, data })), systemInstruction })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `تعذر الاتصال بالمساعد (HTTP ${response.status}).`);
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('لم يصل رد نصي من النموذج. حاول مرة أخرى.');
      updateChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, { role: 'assistant', content: data.reply }], updatedAt: Date.now() }));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'تعذر إرسال الرسالة. حاول مرة أخرى.'); }
    finally { setLoading(false); }
  }

  async function sendMessage(event, overrideText) {
    event?.preventDefault();
    const text = (typeof overrideText === 'string' ? overrideText : input).trim();
    if ((!text && !attachments.length) || loading || !activeChat) return;
    const files = attachments.map(({ name, mimeType, data, kind, preview }) => ({ name, mimeType, data, kind, preview }));
    const userMessage = { role: 'user', content: text || 'يرجى تحليل المرفق.', attachments: files.map(({ name, mimeType, kind, preview }) => ({ name, mimeType, kind, preview })) };
    const updatedMessages = [...messages, userMessage];
    const chatId = activeChat.id;
    updateChat(chatId, (chat) => ({ ...chat, title: chat.messages.length ? chat.title : formatTitle(text, files), messages: updatedMessages, updatedAt: Date.now() }));
    setInput(''); setAttachments([]); setError('');
    const imageGeneration = imageMode || detectImageRequest(text);
    setImageMode(false);
    await requestAssistant({ chatId, baseMessages: updatedMessages, userMessage, files, imageGeneration });
  }

  async function regenerate(messageIndex) {
    if (loading || !activeChat) return;
    const lastUserIndex = messages.slice(0, messageIndex).map((message) => message.role).lastIndexOf('user');
    if (lastUserIndex < 0) return;
    const userMessage = messages[lastUserIndex];
    const previousMessages = messages.slice(0, lastUserIndex + 1);
    const files = (userMessage.attachments || []).filter((item) => item.data && item.mimeType).map((item) => ({ mimeType: item.mimeType, data: item.data }));
    const chatId = activeChat.id;
    updateChat(chatId, (chat) => ({ ...chat, messages: previousMessages }));
    await requestAssistant({ chatId, baseMessages: previousMessages, userMessage, files, imageGeneration: Boolean(detectImageRequest(userMessage.content)) });
  }

  function handleFileChange(event) { addFiles(event.target.files); }
  function handleSuggestion(text) { setInput(text); document.querySelector('.message-input')?.focus(); }
  function handleToggleTheme() { updateSetting('theme', darkMode ? 'light' : 'dark'); }

  return <div className={`chat-app${darkMode ? ' chat-dark' : ''}`} dir="rtl">
    <header className="chat-header" dir="ltr">
      <button className="ui-icon-button header-menu-button" type="button" aria-label="فتح قائمة المحادثات" onClick={() => setSidebarOpen((open) => !open)}>☰</button>
      <div className="header-brand" dir="rtl"><Logo size={34}/><span>ذكاء بلس</span></div>
      <button className="ui-icon-button theme-button" type="button" aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'} onClick={handleToggleTheme}>{darkMode ? <SunIcon/> : <MoonIcon/>}</button>
    </header>

    <main className="chat-main">
      <section className={`conversation-area${messages.length === 0 ? ' conversation-empty' : ''}`} aria-label="المحادثة">
        <div className="message-list" aria-live="polite">
          {messages.map((message, index) => <article className={`message-row message-${message.role}`} key={`${activeChatId}-${index}`}>
            {message.role === 'assistant' && <Logo size={30} className="message-avatar"/>}
            <div className="message-bubble">
              {message.role === 'assistant' && <div className="message-author">ذكاء بلس</div>}
              {message.attachments?.length > 0 && <div className="message-attachments">{message.attachments.map((file, fileIndex) => file.preview ? <img key={`${file.name}-${fileIndex}`} src={file.preview} alt={file.name}/> : null)}</div>}
              {message.imageUrl && <div className="generated-image-card"><img src={message.imageUrl} alt={message.imagePrompt || 'صورة مولدة'} /></div>}
              {message.content && !message.imageUrl && <MessageContent content={message.content} onPreview={setPreview}/>} 
            </div>
          </article>)}
          {loading && <article className="message-row message-assistant" aria-label="المساعد يكتب"><Logo size={30} className="message-avatar"/><div className="message-bubble typing-bubble"><span>يكتب...</span></div></article>}
          <div ref={bottomRef}/>
        </div>
      </section>
      <div className="composer-area">
        {error && <div className="chat-error" role="alert">{error}</div>}
        <div className="composer-tools">
          <button className={`deep-thinking-button${deepThinking ? ' deep-thinking-active' : ''}`} type="button" aria-pressed={deepThinking} onClick={() => setDeepThinking((active) => !active)}>تفكير عميق</button>
          <label className="model-select-wrap" htmlFor="model-select">
            <span className="model-select-label">النموذج</span>
            <select id="model-select" name="selectedModel" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              <option value="gemini-3.8-flash">Gemini-3.8-Flash</option>
              <option value="deepseek-v4-pro">DeepSeek-V4-Pro</option>
            </select>
          </label>
        </div>
        <form className="message-composer" onSubmit={sendMessage}>
          <textarea className="message-input" rows={1} value={input} onChange={(event) => setInput(event.target.value)} placeholder="اكتب رسالتك..." />
          <button className="send-button" type="submit" disabled={(!input.trim() && !attachments.length) || loading} aria-label="إرسال الرسالة">↑</button>
        </form>
        <p className="composer-disclaimer">قد ينتج النموذج إجابات غير دقيقة؛ تحقّق من المعلومات المهمة.</p>
      </div>
    </main>
    {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)}/>} 
  </div>;
}

