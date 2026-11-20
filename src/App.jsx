import { useEffect, useRef, useState } from 'react';

const initialMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'أهلاً بك في ذكاء بلس | Zaka+، مساعدك الذكي. كيف يمكنني مساعدتك اليوم؟'
};

const models = [
  { id: 'gemini', label: 'Gemini 3.8 Flash' },
  { id: 'qwen', label: 'Qwen 2.5 72B' },
  { id: 'deepseek', label: 'DeepSeek R1' },
  { id: 'llama', label: 'Llama 3.3 70B (سريع وذكي)' }
];

const suggestions = [
  { title: 'اكتب لي رسالة', detail: 'صياغة رسالة واضحة ومناسبة' },
  { title: 'اشرح لي موضوعاً', detail: 'شرح مبسّط خطوة بخطوة' },
  { title: 'ساعدني في فكرة', detail: 'عصف ذهني واقتراحات جديدة' }
];

const CLIENT_TIMEOUT_MS = 30000;

async function getAssistantReply(conversation, model) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: conversation
          .filter((message) => message.id !== 'welcome' && !message.id.startsWith('error-'))
          .map(({ role, content }) => ({ role, content }))
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `تعذر الاتصال بالمساعد (HTTP ${response.status}).`);
    if (typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('لم يصل رد نصي من النموذج المختار. حاول مرة أخرى.');
    return result.reply;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('استغرق الطلب وقتاً أطول من المتوقع (30 ثانية). تحقق من الاتصال ثم أعد المحاولة.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function BrandMark({ small = false }) {
  return <span className={`brand-mark${small ? ' brand-mark-small' : ''}`}>Z+</span>;
}

function NewChatIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2.5-6.5L5 12Z" /><path d="m11.5 12.5 4-4" /></svg>;
}

function CopyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>;
}

export default function App() {
  const [chats, setChats] = useState([{ id: 'chat-1', title: 'محادثة جديدة' }]);
  const [activeChatId, setActiveChatId] = useState('chat-1');
  const [messagesByChat, setMessagesByChat] = useState({ 'chat-1': [initialMessage] });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [selectedModel, setSelectedModel] = useState('gemini');
  const textareaRef = useRef(null);
  const bottomRef = useRef(null);
  const requestIdRef = useRef(0);
  const messages = messagesByChat[activeChatId] || [initialMessage];
  const isEmptyChat = messages.length === 1 && messages[0].id === 'welcome';
  const selectedModelLabel = models.find((model) => model.id === selectedModel)?.label || models[0].label;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, isLoading]);
  useEffect(() => {
    if (copiedId === null) return undefined;
    const timer = window.setTimeout(() => setCopiedId(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  function createNewChat() {
    const id = `chat-${Date.now()}`;
    setChats((current) => [{ id, title: 'محادثة جديدة' }, ...current]);
    setMessagesByChat((current) => ({ ...current, [id]: [initialMessage] }));
    setActiveChatId(id);
    setInput('');
    setIsLoading(false);
    setSidebarOpen(false);
    requestIdRef.current += 1;
  }

  function selectChat(id) {
    setActiveChatId(id);
    setInput('');
    setSidebarOpen(false);
    setIsLoading(false);
    requestIdRef.current += 1;
  }

  async function handleSend(event) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    const chatId = activeChatId;
    const model = selectedModel;
    const userMessage = { id: `user-${Date.now()}`, role: 'user', content: text };
    const updatedMessages = [...messages, userMessage];
    const requestId = ++requestIdRef.current;

    setMessagesByChat((current) => ({ ...current, [chatId]: updatedMessages }));
    setChats((current) => current.map((chat) => chat.id === chatId && chat.title === 'محادثة جديدة' ? { ...chat, title: text.length > 34 ? `${text.slice(0, 34)}…` : text } : chat));
    setInput('');
    setIsLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const answer = await getAssistantReply(updatedMessages, model);
      if (requestId !== requestIdRef.current) return;
      setMessagesByChat((current) => ({ ...current, [chatId]: [...(current[chatId] || updatedMessages), { id: `assistant-${Date.now()}`, role: 'assistant', content: answer }] }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setMessagesByChat((current) => ({ ...current, [chatId]: [...(current[chatId] || updatedMessages), { id: `error-${Date.now()}`, role: 'assistant', content: error?.message || 'تعذر الاتصال بالمساعد. حاول مرة أخرى.' }] }));
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }

  function handleInputChange(event) {
    setInput(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
  }

  async function copyMessage(message) {
    try { await navigator.clipboard.writeText(message.content); setCopiedId(message.id); }
    catch { setCopiedId(null); }
  }

  return (
    <div className="app-shell" dir="rtl">
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-top">
          <a className="brand" href="#home" onClick={(event) => event.preventDefault()}><BrandMark /><span className="brand-name">ذكاء بلس</span></a>
          <button className="icon-button mobile-close" type="button" aria-label="إغلاق القائمة" onClick={() => setSidebarOpen(false)}><span aria-hidden="true">×</span></button>
          <button className="icon-button desktop-toggle" type="button" aria-label="بدء محادثة جديدة" onClick={createNewChat}><NewChatIcon /></button>
        </div>
        <button className="new-chat-button" type="button" onClick={createNewChat}><NewChatIcon /><span>محادثة جديدة</span></button>
        <div className="history-heading">الأخيرة</div>
        <nav className="chat-history" aria-label="المحادثات السابقة">
          {chats.map((chat) => <button className={`history-item${chat.id === activeChatId ? ' history-item-active' : ''}`} key={chat.id} type="button" title={chat.title} onClick={() => selectChat(chat.id)}><span className="history-bubble" aria-hidden="true" /><span>{chat.title}</span></button>)}
        </nav>
        <div className="sidebar-footer"><BrandMark small /><div><div className="footer-title">Zaka+ للذكاء الاصطناعي</div><div className="footer-caption">اختر النموذج المناسب لمحادثتك</div></div></div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" type="button" aria-label="إغلاق القائمة" onClick={() => setSidebarOpen(false)} />}
      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu" type="button" aria-label="فتح قائمة المحادثات" onClick={() => setSidebarOpen(true)}><span className="menu-glyph" aria-hidden="true">☰</span></button>
          <div className="model-selector"><span>ذكاء بلس</span><select className="model-version" aria-label="اختيار نموذج الذكاء الاصطناعي" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={isLoading}>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select><span className="chevron" aria-hidden="true">⌄</span></div>
          <div className="topbar-spacer" /><span className="topbar-status"><span className="status-dot" /> جاهز</span>
        </header>
        <section className={`conversation${isEmptyChat ? ' conversation-empty' : ''}`} aria-label="المحادثة">
          {isEmptyChat ? <div className="welcome-panel"><div className="welcome-mark"><BrandMark /></div><h1>كيف أقدر أساعدك؟</h1><p>اسأل، اكتب، أو ابدأ بفكرة — وأنا أساعدك في الخطوة التالية.</p><div className="suggestion-grid">{suggestions.map((suggestion) => <button className="suggestion-card" key={suggestion.title} type="button" onClick={() => { setInput(suggestion.title); textareaRef.current?.focus(); }}><span className="suggestion-title">{suggestion.title}</span><span className="suggestion-detail">{suggestion.detail}</span></button>)}</div></div> : <div className="message-list">
            {messages.filter((message) => message.id !== 'welcome').map((message) => <article className={`message message-${message.role}`} key={message.id}>{message.role === 'assistant' && <BrandMark small />}<div className="message-body">{message.role === 'assistant' && <div className="message-author">ذكاء بلس</div>}<div className="message-content">{message.content}</div>{message.role === 'assistant' && !message.id.startsWith('error-') && <button className="copy-button" type="button" onClick={() => copyMessage(message)} aria-label="نسخ الرد"><CopyIcon /><span>{copiedId === message.id ? 'تم النسخ' : 'نسخ'}</span></button>}</div></article>)}
            {isLoading && <article className="message message-assistant" aria-label="المساعد يكتب"><BrandMark small /><div className="message-body"><div className="message-author">ذكاء بلس</div><div className="typing-indicator"><i /><i /><i /></div></div></article>}
            <div ref={bottomRef} />
          </div>}
        </section>
        <div className="composer-area"><form className="composer" onSubmit={handleSend}><textarea ref={textareaRef} rows={1} value={input} onChange={handleInputChange} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(event); } }} placeholder="اكتب رسالتك إلى ذكاء بلس..." aria-label="رسالتك" disabled={isLoading} /><button className="send-button" type="submit" disabled={!input.trim() || isLoading} aria-label="إرسال الرسالة"><SendIcon /></button></form><p className="disclaimer">قد ينتج {selectedModelLabel} إجابات غير دقيقة؛ تحقّق من المعلومات المهمة.</p></div>
      </main>
    </div>
  );
}
