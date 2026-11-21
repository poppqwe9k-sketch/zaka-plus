import { useEffect, useRef, useState } from 'react';
import './chat-redesign.css';

const MODEL_ID = 'gemini-3.1-flash-lite';
const MODEL_NAME = 'Gemini 3.1 Flash Lite';
const STORAGE_KEY = 'zaka-plus-chat-v5';
const MAX_FILE_BYTES = 7 * 1024 * 1024;

function newChat() {
  return { id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: 'محادثة جديدة', messages: [], updatedAt: Date.now() };
}

function loadAppState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const chats = Array.isArray(saved.chats)
      ? saved.chats.map((chat) => ({ ...chat, messages: Array.isArray(chat.messages) ? chat.messages : [] }))
      : [];
    const normalizedChats = chats.length ? chats : [newChat()];
    return {
      chats: normalizedChats,
      activeChatId: normalizedChats.some((chat) => chat.id === saved.activeChatId) ? saved.activeChatId : normalizedChats[0].id,
      darkMode: saved.darkMode === true,
    };
  } catch {
    const chat = newChat();
    return { chats: [chat], activeChatId: chat.id, darkMode: false };
  }
}

function Logo({ size = 34, className = '' }) {
  return <img src="/logo.svg" width={size} height={size} className={className} alt="شعار ذكاء بلس" />;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function MenuIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
}

function SunIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>;
}

function MoonIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.6 8.6 0 1 0 20.2 15.4Z"/></svg>;
}

function formatTitle(text, files) {
  const title = text.trim() || files[0]?.name || 'محادثة جديدة';
  return title.length > 38 ? `${title.slice(0, 38)}…` : title;
}

export default function App() {
  const initial = useRef(loadAppState()).current;
  const [chats, setChats] = useState(initial.chats);
  const [activeChatId, setActiveChatId] = useState(initial.activeChatId);
  const [darkMode, setDarkMode] = useState(initial.darkMode);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deepThinking, setDeepThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const bottomRef = useRef(null);
  const menuRef = useRef(null);
  const imageInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const activeChat = chats.find((chat) => chat.id === activeChatId) || chats[0];
  const messages = activeChat?.messages || [];

  useEffect(() => {
    try {
      const safeChats = chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map(({ role, content, attachments: files = [] }) => ({
          role,
          content,
          attachments: files.map(({ name, mimeType, kind }) => ({ name, mimeType, kind })),
        })),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats: safeChats, activeChatId, darkMode }));
    } catch { /* Chat remains available if local storage is unavailable or full. */ }
  }, [chats, activeChatId, darkMode]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  useEffect(() => {
    if (!sidebarOpen && !menuOpen) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onPointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  function createNewChat() {
    const chat = newChat();
    setChats((current) => [chat, ...current]);
    setActiveChatId(chat.id);
    setInput('');
    setAttachments([]);
    setError('');
    setDeepThinking(false);
    setLoading(false);
    setSidebarOpen(false);
  }

  function selectChat(chatId) {
    setActiveChatId(chatId);
    setInput('');
    setAttachments([]);
    setError('');
    setLoading(false);
    setSidebarOpen(false);
  }

  function removeChat(chatId, event) {
    event.stopPropagation();
    const remaining = chats.filter((chat) => chat.id !== chatId);
    const nextChats = remaining.length ? remaining : [newChat()];
    setChats(nextChats);
    if (activeChatId === chatId) setActiveChatId(nextChats[0].id);
  }

  async function addFiles(fileList) {
    const selected = Array.from(fileList || []);
    if (!selected.length) return;
    setError('');
    if (attachments.length + selected.length > 4) {
      setError('يمكن إرفاق 4 ملفات كحد أقصى.');
      return;
    }
    try {
      const loaded = await Promise.all(selected.map((file) => {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: الحد الأقصى لحجم الملف 7 ميغابايت.`);
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf';
        if (!isImage && !isPdf) throw new Error('الصيغ المدعومة هي الصور وملفات PDF فقط.');
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, mimeType: file.type, data: reader.result, kind: isImage ? 'image' : 'pdf', preview: isImage ? reader.result : '' });
          reader.onerror = () => reject(new Error(`تعذرت قراءة الملف ${file.name}.`));
          reader.readAsDataURL(file);
        });
      }));
      setAttachments((current) => [...current, ...loaded]);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : 'تعذرت قراءة الملف.');
    } finally {
      setMenuOpen(false);
      [imageInputRef, cameraInputRef, pdfInputRef].forEach((ref) => { if (ref.current) ref.current.value = ''; });
    }
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const text = input.trim();
    if ((!text && !attachments.length) || loading || !activeChat) return;

    const sentAttachments = attachments.map(({ name, mimeType, data, kind, preview }) => ({ name, mimeType, data, kind, preview }));
    const userMessage = {
      role: 'user',
      content: text || 'يرجى تحليل المرفق.',
      attachments: sentAttachments.map(({ name, mimeType, kind, preview }) => ({ name, mimeType, kind, preview })),
    };
    const updatedMessages = [...messages, userMessage];
    const chatId = activeChat.id;
    setChats((current) => current.map((chat) => chat.id === chatId ? {
      ...chat,
      title: chat.messages.length ? chat.title : formatTitle(text, sentAttachments),
      messages: updatedMessages,
      updatedAt: Date.now(),
    } : chat));
    setInput('');
    setAttachments([]);
    setError('');
    setLoading(true);

    const normalInstruction = 'أنت مساعد ذكاء بلس | Zaka+. أجب بوضوح ودقة وباللغة العربية ما لم يطلب المستخدم غير ذلك.';
    const systemInstruction = deepThinking
      ? `${normalInstruction} قدّم تحليلاً متأنياً وإجابة مفصلة ومنظمة، مع بيان الافتراضات وعدم اليقين. لا تدّعِ إجراء بحث مباشر على الويب أو امتلاك معلومات آنية ما لم تتوفر لك أداة بحث فعلية.`
      : normalInstruction;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: updatedMessages.slice(-10).map(({ role, content }) => ({ role, content })),
          attachments: sentAttachments.map(({ mimeType, data }) => ({ mimeType, data })),
          systemInstruction,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `تعذر الاتصال بالمساعد (HTTP ${response.status}).`);
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('لم يصل رد نصي من النموذج. حاول مرة أخرى.');
      const assistantMessage = { role: 'assistant', content: data.reply };
      setChats((current) => current.map((chat) => chat.id === chatId ? { ...chat, messages: [...chat.messages, assistantMessage], updatedAt: Date.now() } : chat));
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'تعذر إرسال الرسالة. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(event) {
    addFiles(event.target.files);
  }

  return (
    <div className={`chat-app${darkMode ? ' chat-dark' : ''}`} dir="rtl">
      <header className="chat-header" dir="ltr">
        <button className="ui-icon-button header-menu-button" type="button" aria-label="فتح قائمة المحادثات" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}><MenuIcon /></button>
        <div className="header-brand" dir="rtl"><Logo size={34} /><span>ذكاء بلس</span></div>
        <button className="ui-icon-button theme-button" type="button" aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'} title={darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'} onClick={() => setDarkMode((value) => !value)}>{darkMode ? <SunIcon /> : <MoonIcon />}</button>
      </header>

      <aside className={`chat-sidebar${sidebarOpen ? ' sidebar-visible' : ''}`} aria-label="قائمة المحادثات" aria-hidden={!sidebarOpen}>
        <div className="sidebar-heading">
          <div className="sidebar-brand"><Logo size={30} /><span>ذكاء بلس</span></div>
          <button className="ui-icon-button sidebar-close" type="button" aria-label="إغلاق القائمة" onClick={() => setSidebarOpen(false)}>×</button>
        </div>
        <button className="new-chat-button" type="button" onClick={createNewChat}><PlusIcon /><span>محادثة جديدة</span></button>
        <div className="history-label">سجل المحادثات</div>
        <nav className="chat-history">
          {chats.map((chat) => <div className={`history-entry${chat.id === activeChatId ? ' history-entry-active' : ''}`} key={chat.id}>
            <button type="button" className="history-select" onClick={() => selectChat(chat.id)} title={chat.title}><span className="history-text">{chat.title}</span><span className="history-count">{chat.messages.length ? chat.messages.length : ''}</span></button>
            <button type="button" className="history-delete" aria-label={`حذف ${chat.title}`} title="حذف المحادثة" onClick={(event) => removeChat(chat.id, event)}>×</button>
          </div>)}
        </nav>
        <div className="sidebar-footer"><span>{MODEL_NAME}</span><span className="model-status-dot" /></div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" type="button" aria-label="إغلاق القائمة" onClick={() => setSidebarOpen(false)} />}

      <main className="chat-main">
        <section className={`conversation-area${messages.length === 0 ? ' conversation-empty' : ''}`} aria-label="المحادثة">
          {!messages.length && <div className="welcome-card"><Logo size={66} className="welcome-logo" /><h1>كيف أقدر أساعدك؟</h1><p>اسأل، اكتب، أو ابدأ بفكرة جديدة.</p><span className="welcome-model">{MODEL_NAME}</span></div>}
          <div className="message-list" aria-live="polite">
            {messages.map((message, index) => <article className={`message-row message-${message.role}`} key={`${activeChatId}-${index}`}>
              {message.role === 'assistant' && <Logo size={30} className="message-avatar" />}
              <div className="message-bubble">
                {message.role === 'assistant' && <div className="message-author">ذكاء بلس</div>}
                {message.attachments?.length > 0 && <div className="message-attachments">{message.attachments.map((file, fileIndex) => file.preview
                  ? <img key={`${file.name}-${fileIndex}`} src={file.preview} alt={file.name} />
                  : <span className="attachment-file-label" key={`${file.name}-${fileIndex}`}>▤ {file.name}</span>)}</div>}
                <div className="message-text">{message.content}</div>
              </div>
            </article>)}
            {loading && <article className="message-row message-assistant" aria-label="المساعد يكتب"><Logo size={30} className="message-avatar" /><div className="message-bubble typing-bubble"><div className="message-author">ذكاء بلس</div><span className="typing-indicator" aria-label="يكتب الآن"><i /><i /><i /></span></div></article>}
            <div ref={bottomRef} />
          </div>
        </section>

        <div className="composer-area">
          {error && <div className="chat-error" role="alert">{error}</div>}
          {attachments.length > 0 && <div className="pending-attachments" aria-label="المرفقات المحددة">{attachments.map((file, index) => <div className="pending-file" key={`${file.name}-${index}`}>
            {file.preview ? <img src={file.preview} alt="" /> : <span className="pdf-badge">PDF</span>}
            <span className="pending-file-name" title={file.name}>{file.name}</span>
            <button type="button" className="remove-attachment" aria-label={`إزالة ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
          </div>)}</div>}
          <div className="composer-tools">
            <button className={`deep-thinking-button${deepThinking ? ' deep-thinking-active' : ''}`} type="button" aria-pressed={deepThinking} onClick={() => setDeepThinking((value) => !value)}><span aria-hidden="true">✦</span> تفكير عميق</button>
            {deepThinking && <span className="thinking-hint">إجابات أكثر تحليلاً وتفصيلاً</span>}
          </div>
          <form className="message-composer" onSubmit={sendMessage}>
            <div className="attachment-menu-wrap" ref={menuRef}>
              <button className="ui-icon-button attach-button" type="button" aria-label="إضافة مرفق" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><PlusIcon /></button>
              {menuOpen && <div className="attachment-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => imageInputRef.current?.click()}><span className="menu-option-icon">▧</span>رفع صورة</button>
                <button type="button" role="menuitem" onClick={() => cameraInputRef.current?.click()}><span className="menu-option-icon">◎</span>الكاميرا</button>
                <button type="button" role="menuitem" onClick={() => pdfInputRef.current?.click()}><span className="menu-option-icon">▤</span>رفع ملف PDF</button>
              </div>}
            </div>
            <input ref={imageInputRef} className="hidden-file-input" type="file" accept="image/*" multiple onChange={handleFileChange} />
            <input ref={cameraInputRef} className="hidden-file-input" type="file" accept="image/*" capture="environment" onChange={handleFileChange} />
            <input ref={pdfInputRef} className="hidden-file-input" type="file" accept="application/pdf,.pdf" multiple onChange={handleFileChange} />
            <textarea className="message-input" rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event); } }} placeholder="اكتب رسالتك هنا…" aria-label="رسالتك" />
            <button className="send-button" type="submit" disabled={(!input.trim() && !attachments.length) || loading} aria-label="إرسال الرسالة">↑</button>
          </form>
          <p className="composer-disclaimer">قد ينتج النموذج إجابات غير دقيقة؛ تحقّق من المعلومات المهمة.</p>
        </div>
      </main>
    </div>
  );
}
