import { useEffect, useRef, useState } from 'react';
import './pro-features.css';

const MODEL_ID = 'gemini-3.1-flash-lite';
const MODEL_NAME = 'Gemini 3.1 Flash Lite';
const STORAGE_KEY = 'zaka-plus-chat-v4';
const MAX_FILE_BYTES = 7 * 1024 * 1024;
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);

export function ZakaPlusIcon({ size = 32, className = '' }) {
  return <img src="/logo.svg" width={size} height={size} className={className} alt="شعار ذكاء بلس" />;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      messages: Array.isArray(saved.messages) ? saved.messages : [],
      darkMode: saved.darkMode === true,
    };
  } catch {
    return { messages: [], darkMode: false };
  }
}

export default function App() {
  const saved = useRef(readSaved()).current;
  const [messages, setMessages] = useState(saved.messages);
  const [darkMode, setDarkMode] = useState(saved.darkMode);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deepThinking, setDeepThinking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const bottomRef = useRef(null);
  const imageInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, darkMode })); } catch { /* Local storage is optional. */ }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading, darkMode]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function closeOnOutsideClick(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  async function addFiles(fileList) {
    const selected = Array.from(fileList || []);
    if (!selected.length) return;
    setError('');
    if (attachments.length + selected.length > 4) {
      setError('يمكن إرفاق 4 ملفات كحد أقصى.');
      return;
    }
    try {
      const loaded = await Promise.all(selected.map(async (file) => {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: الحد الأقصى لحجم الملف 7 ميغابايت.`);
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf';
        const isText = TEXT_TYPES.has(file.type) || /\.(txt|md|csv|json)$/i.test(file.name);
        if (!isImage && !isPdf && !isText) {
          throw new Error(`${file.name}: الصيغ المدعومة هي الصور وPDF والملفات النصية (TXT, MD, CSV, JSON).`);
        }
        if (isText) {
          const text = await file.text();
          return { name: file.name, kind: 'text', text };
        }
        return await new Promise((resolve, reject) => {
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
      if (imageInputRef.current) imageInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const text = input.trim();
    if ((!text && !attachments.length) || loading) return;

    const attachedText = attachments.filter((item) => item.kind === 'text')
      .map((item) => `\n\n[محتوى الملف: ${item.name}]\n${item.text}`)
      .join('');
    const userMessage = { role: 'user', content: `${text || 'يرجى تحليل المرفق.'}${attachedText}` };
    const nextMessages = [...messages, userMessage];
    const binaryAttachments = attachments
      .filter((item) => item.kind === 'image' || item.kind === 'pdf')
      .map(({ mimeType, data }) => ({ mimeType, data }));
    setMessages(nextMessages);
    setInput('');
    setAttachments([]);
    setError('');
    setLoading(true);

    const normalInstruction = 'أنت مساعد ذكاء بلس | Zaka+. أجب بوضوح ودقة وباللغة العربية ما لم يطلب المستخدم غير ذلك.';
    const systemInstruction = deepThinking
      ? `${normalInstruction} قدّم إجابة مفصلة وعميقة ومدروسة. عند الحاجة إلى معلومات حديثة، حاول تقديم أفضل إجابة ممكنة مع توضيح حدود معرفتك، ولا تدّعِ إجراء بحث مباشر على الويب إن لم تكن قد فعلت ذلك.`
      : normalInstruction;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: nextMessages.slice(-10).map(({ role, content }) => ({ role, content })),
          attachments: binaryAttachments,
          systemInstruction,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `تعذر الاتصال بالمساعد (HTTP ${response.status}).`);
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('لم يصل رد نصي من النموذج. حاول مرة أخرى.');
      setMessages((current) => [...current, { role: 'assistant', content: data.reply }]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'تعذر إرسال الرسالة. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setAttachments([]);
    setError('');
  }

  return (
    <div className={`zaka-chat${darkMode ? ' is-dark' : ''}`} dir="rtl">
      <style>{`
        .zaka-chat{--bg:#f7f8fa;--surface:#fff;--surface-soft:#f1f3f6;--text:#20242c;--muted:#727986;--line:#e4e7ec;--accent:#17191f;min-height:100vh;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;transition:background .2s,color .2s}
        .zaka-chat.is-dark{--bg:#111318;--surface:#191c23;--surface-soft:#242832;--text:#f2f4f8;--muted:#a0a7b4;--line:#303540;--accent:#f2f4f8}
        .zaka-header{min-height:68px;display:flex;align-items:center;gap:14px;padding:10px clamp(16px,5vw,64px);background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
        .zaka-brand{font-weight:750;font-size:18px;white-space:nowrap}.zaka-model{font-size:12px;color:var(--muted);background:var(--surface-soft);padding:8px 12px;border-radius:999px;white-space:nowrap}.zaka-header-spacer{flex:1}
        .zaka-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 13px;border:1px solid var(--line);border-radius:12px;color:var(--text);background:var(--surface);box-shadow:0 2px 6px #0000000a;cursor:pointer;transition:transform .16s,background .16s,border-color .16s,box-shadow .16s}.zaka-button:hover{transform:translateY(-1px);background:var(--surface-soft);box-shadow:0 5px 14px #00000012}.zaka-button:focus-visible,.zaka-menu-item:focus-visible,.zaka-input:focus-visible{outline:3px solid #6478ff66;outline-offset:2px}.zaka-clear{font-size:13px}.zaka-theme{width:40px;padding:0;font-size:17px}
        .zaka-content{width:min(820px,100%);margin:0 auto;flex:1;padding:40px 20px 24px;display:flex;flex-direction:column}.zaka-welcome{text-align:center;margin:auto auto 28px}.zaka-welcome h1{font-size:clamp(25px,5vw,36px);margin:12px 0 10px}.zaka-welcome p{color:var(--muted);margin:0;font-size:15px}.zaka-welcome-icon{margin:0 auto;display:block}
        .zaka-messages{display:flex;flex-direction:column;gap:18px;padding-bottom:24px}.zaka-message{max-width:88%;padding:14px 18px;border:1px solid var(--line);border-radius:18px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 3px 12px #00000008}.zaka-user{align-self:flex-start;background:var(--surface-soft);border-bottom-right-radius:5px}.zaka-assistant{align-self:flex-end;background:var(--surface);border-bottom-left-radius:5px}.zaka-author{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:5px}.zaka-error{color:#b42318;background:#fff0f0;border:1px solid #ffd7d7;padding:11px 14px;border-radius:12px;margin:0 0 12px}.is-dark .zaka-error{color:#ffb4ad;background:#321f22;border-color:#60383d}
        .zaka-composer-wrap{position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 20%);padding:16px 0 8px}.zaka-tools{display:flex;align-items:center;gap:9px;margin:0 0 10px}.zaka-toggle{min-height:36px;border-radius:999px;font-size:12px;color:var(--muted);padding:0 13px}.zaka-toggle.active{color:#fff;background:#4f46e5;border-color:#4f46e5;box-shadow:0 0 0 3px #4f46e522,0 4px 16px #4f46e544}.is-dark .zaka-toggle.active{background:#7168ff;border-color:#7168ff}
        .zaka-form{display:flex;align-items:flex-end;gap:9px;padding:10px;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 8px 28px #20212312}.zaka-form:focus-within{border-color:#9aa3b2;box-shadow:0 8px 28px #20212318}.zaka-input{flex:1;width:100%;border:0;outline:0;resize:vertical;max-height:180px;min-height:42px;padding:9px 7px;color:var(--text);font:inherit;line-height:1.6;background:transparent}.zaka-input::placeholder{color:var(--muted)}
        .zaka-attach-wrap{position:relative;flex:0 0 auto}.zaka-plus{width:42px;height:42px;padding:0;border-radius:14px;font-size:24px}.zaka-plus svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}.zaka-send{width:42px;height:42px;padding:0;border:0;border-radius:14px;color:#fff;background:#20232b;box-shadow:0 4px 10px #0002;font-size:21px}.zaka-send:hover:not(:disabled){background:#3b4250}.is-dark .zaka-send{color:#17191f;background:#f2f4f8}.is-dark .zaka-send:hover:not(:disabled){background:#dce1ea}.zaka-send:disabled{opacity:.42;cursor:not-allowed;box-shadow:none}.zaka-menu{position:absolute;z-index:5;right:0;bottom:calc(100% + 10px);width:min(230px,calc(100vw - 32px));padding:7px;border:1px solid var(--line);border-radius:15px;background:var(--surface);box-shadow:0 12px 36px #0002;display:grid;gap:3px}.zaka-menu-item{display:flex;align-items:center;gap:11px;min-height:44px;padding:0 11px;border:0;border-radius:10px;text-align:right;font:inherit;font-size:13px;color:var(--text);background:transparent;cursor:pointer;transition:background .15s}.zaka-menu-item:hover{background:var(--surface-soft)}.zaka-menu-icon{width:25px;height:25px;display:grid;place-items:center;border-radius:8px;background:var(--surface-soft);font-size:14px}
        .zaka-files{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}.zaka-file-chip{display:flex;align-items:center;gap:8px;max-width:100%;padding:6px 8px 6px 10px;border:1px solid var(--line);border-radius:11px;background:var(--surface);font-size:12px}.zaka-file-chip img{width:34px;height:34px;object-fit:cover;border-radius:7px}.zaka-file-name{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.zaka-remove-file{width:25px;height:25px;border:0;border-radius:8px;background:var(--surface-soft);color:var(--muted);cursor:pointer}.zaka-note{text-align:center;font-size:11px;color:var(--muted);margin:10px 0 0}.zaka-hidden{display:none!important}
        @media(max-width:600px){.zaka-header{min-height:60px;padding:8px 12px;gap:8px}.zaka-brand{font-size:15px}.zaka-model{font-size:10px;padding:7px 9px}.zaka-button{min-height:37px;padding:0 10px}.zaka-theme{width:37px;padding:0}.zaka-content{padding:25px 14px 16px}.zaka-message{max-width:96%;padding:12px 14px}.zaka-form{gap:6px;padding:8px;border-radius:17px}.zaka-plus,.zaka-send{width:39px;height:39px;flex-basis:39px}.zaka-tools{gap:7px}.zaka-toggle{padding:0 11px;font-size:11px}}
        @media(max-width:380px){.zaka-header{gap:5px}.zaka-brand{font-size:13px}.zaka-model{font-size:9px;padding:6px 7px}.zaka-clear{font-size:11px;padding:0 7px}}
      `}</style>
      <header className="zaka-header">
        <div className="zaka-brand">ذكاء بلس</div>
        <span className="zaka-model">{MODEL_NAME}</span>
        <span className="zaka-header-spacer" />
        <button className="zaka-button zaka-theme" type="button" onClick={() => setDarkMode((value) => !value)} aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'} title={darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'}>{darkMode ? '☀' : '☾'}</button>
        <button className="zaka-button zaka-clear" type="button" onClick={clearChat}>محادثة جديدة</button>
      </header>
      <main className="zaka-content">
        {!messages.length && <div className="zaka-welcome"><ZakaPlusIcon size={72} className="zaka-welcome-icon" /><h1>كيف أقدر أساعدك؟</h1><p>ابدأ محادثة جديدة مع {MODEL_NAME}</p></div>}
        <section className="zaka-messages" aria-live="polite" aria-label="المحادثة">
          {messages.map((message, index) => <article className={`zaka-message ${message.role === 'user' ? 'zaka-user' : 'zaka-assistant'}`} key={`${index}-${message.role}`}>
            {message.role === 'assistant' && <div className="zaka-author">ذكاء بلس · {MODEL_NAME}</div>}
            {message.content}
          </article>)}
          {loading && <article className="zaka-message zaka-assistant"><div className="zaka-author">ذكاء بلس · {MODEL_NAME}</div>يكتب الآن…</article>}
          <div ref={bottomRef} />
        </section>
        {error && <p className="zaka-error" role="alert">{error}</p>}
        <div className="zaka-composer-wrap">
          <div className="zaka-tools">
            <button className={`zaka-button zaka-toggle${deepThinking ? ' active' : ''}`} type="button" aria-pressed={deepThinking} onClick={() => setDeepThinking((value) => !value)}>✦ تفكير عميق</button>
          </div>
          {attachments.length > 0 && <div className="zaka-files" aria-label="المرفقات المحددة">{attachments.map((file, index) => <div className="zaka-file-chip" key={`${file.name}-${index}`}>
            {file.preview ? <img src={file.preview} alt="" /> : <span aria-hidden="true">{file.kind === 'pdf' ? 'PDF' : '▤'}</span>}
            <span className="zaka-file-name" title={file.name}>{file.name}</span>
            <button className="zaka-remove-file" type="button" aria-label={`إزالة ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
          </div>)}</div>}
          <form className="zaka-form" onSubmit={sendMessage}>
            <div className="zaka-attach-wrap" ref={menuRef}>
              <button className="zaka-button zaka-plus" type="button" aria-label="إضافة مرفق" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><PlusIcon /></button>
              {menuOpen && <div className="zaka-menu" role="menu">
                <button className="zaka-menu-item" type="button" role="menuitem" onClick={() => imageInputRef.current?.click()}><span className="zaka-menu-icon">▧</span>رفع صورة</button>
                <button className="zaka-menu-item" type="button" role="menuitem" onClick={() => cameraInputRef.current?.click()}><span className="zaka-menu-icon">◎</span>الكاميرا</button>
                <button className="zaka-menu-item" type="button" role="menuitem" onClick={() => fileInputRef.current?.click()}><span className="zaka-menu-icon">▤</span>رفع ملف</button>
              </div>}
            </div>
            <input ref={imageInputRef} className="zaka-hidden" type="file" accept="image/*" multiple onChange={(event) => addFiles(event.target.files)} />
            <input ref={cameraInputRef} className="zaka-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => addFiles(event.target.files)} />
            <input ref={fileInputRef} className="zaka-hidden" type="file" accept="application/pdf,text/plain,text/markdown,text/csv,application/json,.txt,.md,.csv,.json" multiple onChange={(event) => addFiles(event.target.files)} />
            <textarea className="zaka-input" rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event); } }} placeholder="اكتب رسالتك هنا…" aria-label="رسالتك" />
            <button className="zaka-button zaka-send" type="submit" disabled={(!input.trim() && !attachments.length) || loading} aria-label="إرسال">↑</button>
          </form>
          <p className="zaka-note">قد يقدّم النموذج إجابات غير دقيقة؛ تحقّق من المعلومات المهمة.</p>
        </div>
      </main>
    </div>
  );
}
