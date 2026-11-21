import { useEffect, useRef, useState } from 'react';
import './pro-features.css';

const MODEL_ID = 'gemini-3.1-flash-lite';
const MODEL_NAME = 'Gemini 3.1 Flash Lite';
const STORAGE_KEY = 'zaka-plus-chat-v3';
const initialMessages = [];

export function ZakaPlusIcon({ size = 32, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="ذكاء بلس"
    >
      <circle cx="60" cy="60" r="58" fill="#000000" />
      <g
        transform="translate(18, 22) scale(0.7)"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M46 18c-8-9-24-8-30 3-8 1-14 8-13 16-6 5-7 14-2 21-4 7-2 16 5 21 6 5 15 5 21 1 5 6 14 7 21 3 7-4 10-13 7-21 6-5 7-15 2-22 4-7 2-16-5-21-3-2-6-3-8-4z" />
        <line x1="25" y1="26" x2="43" y2="42" />
        <line x1="43" y1="42" x2="22" y2="54" />
        <line x1="22" y1="54" x2="44" y2="69" />
        <line x1="44" y1="69" x2="28" y2="85" />
        <line x1="43" y1="42" x2="62" y2="33" />
        <line x1="44" y1="69" x2="66" y2="62" />
        <line x1="62" y1="33" x2="72" y2="52" />
        <line x1="66" y1="62" x2="75" y2="79" />
        <circle cx="25" cy="26" r="3.5" fill="#FFFFFF" />
        <circle cx="43" cy="42" r="3.5" fill="#FFFFFF" />
        <circle cx="22" cy="54" r="3.5" fill="#FFFFFF" />
        <circle cx="44" cy="69" r="3.5" fill="#FFFFFF" />
        <circle cx="28" cy="85" r="3.5" fill="#FFFFFF" />
        <circle cx="62" cy="33" r="3.5" fill="#FFFFFF" />
        <circle cx="66" cy="62" r="3.5" fill="#FFFFFF" />
        <circle cx="72" cy="52" r="3.5" fill="#FFFFFF" />
        <circle cx="75" cy="79" r="3.5" fill="#FFFFFF" />
        <path d="M84 14h10v10h10v10H94v10H84V34H74V24h10V14z" fill="#FFFFFF" stroke="none" />
      </g>
    </svg>
  );
}

export default function App() {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved : initialMessages;
    } catch {
      return initialMessages;
    }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch { /* Local storage is optional. */ }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function sendMessage(event) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: nextMessages.slice(-10),
          systemInstruction: 'أنت مساعد ذكاء بلس | Zaka+. أجب بوضوح ودقة وباللغة العربية ما لم يطلب المستخدم غير ذلك.'
        })
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
    setError('');
  }

  return (
    <div className="zaka-chat" dir="rtl">
      <style>{`
        .zaka-chat{min-height:100vh;background:#f7f7f8;color:#202123;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column}
        .zaka-header{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(16px,5vw,64px);background:#fff;border-bottom:1px solid #e8e8ec;position:sticky;top:0;z-index:2}
        .zaka-brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:18px}.zaka-logo{display:block;flex:none}
        .zaka-model{font-size:13px;color:#555;background:#f2f2f4;padding:9px 13px;border-radius:999px;white-space:nowrap}.zaka-clear{border:0;background:transparent;color:#666;cursor:pointer;padding:9px 12px;border-radius:9px}.zaka-clear:hover{background:#f1f1f3}
        .zaka-content{width:min(820px,100%);margin:0 auto;flex:1;padding:40px 20px 24px;display:flex;flex-direction:column}.zaka-welcome{text-align:center;margin:auto auto 28px}.zaka-welcome h1{font-size:clamp(25px,5vw,36px);margin:12px 0 10px}.zaka-welcome p{color:#707078;margin:0;font-size:15px}.zaka-welcome-icon{margin:0 auto}
        .zaka-messages{display:flex;flex-direction:column;gap:22px;padding-bottom:24px}.zaka-message{max-width:85%;padding:14px 18px;border-radius:18px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere}.zaka-user{align-self:flex-start;background:#e9e9eb;border-bottom-right-radius:5px}.zaka-assistant{align-self:flex-end;background:#fff;border:1px solid #ececf0;border-bottom-left-radius:5px}.zaka-author{font-size:12px;font-weight:700;color:#75757d;margin-bottom:5px}.zaka-error{color:#a12727;background:#fff0f0;border:1px solid #ffd7d7;padding:11px 14px;border-radius:12px;margin:0 0 12px}
        .zaka-composer-wrap{position:sticky;bottom:0;background:linear-gradient(transparent,#f7f7f8 20%);padding:16px 0 8px}.zaka-form{display:flex;align-items:flex-end;gap:10px;padding:10px;background:#fff;border:1px solid #dedee3;border-radius:20px;box-shadow:0 8px 28px #2021230d}.zaka-input{flex:1;border:0;outline:0;resize:none;max-height:180px;min-height:28px;padding:8px 6px;font:inherit;line-height:1.6;background:transparent}.zaka-send{border:0;background:#171717;color:white;width:42px;height:42px;border-radius:14px;cursor:pointer;font-size:20px}.zaka-send:disabled{opacity:.45;cursor:not-allowed}.zaka-note{text-align:center;font-size:11px;color:#888;margin:10px 0 0}
        @media(max-width:600px){.zaka-header{height:60px;padding:0 14px}.zaka-brand{font-size:16px}.zaka-model{font-size:11px;padding:8px}.zaka-content{padding:25px 14px 16px}.zaka-message{max-width:94%;padding:12px 14px}}
      `}</style>
      <header className="zaka-header">
        <div className="zaka-brand"><ZakaPlusIcon size={38} className="zaka-logo" /><span>ذكاء بلس</span></div>
        <span className="zaka-model">{MODEL_NAME}</span>
        <button className="zaka-clear" type="button" onClick={clearChat}>محادثة جديدة</button>
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
          <form className="zaka-form" onSubmit={sendMessage}>
            <textarea className="zaka-input" rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event); } }} placeholder="اكتب رسالتك هنا…" aria-label="رسالتك" />
            <button className="zaka-send" type="submit" disabled={!input.trim() || loading} aria-label="إرسال">↑</button>
          </form>
          <p className="zaka-note">قد يقدّم النموذج إجابات غير دقيقة؛ تحقّق من المعلومات المهمة.</p>
        </div>
      </main>
    </div>
  );
}
