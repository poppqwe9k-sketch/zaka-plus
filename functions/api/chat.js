const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 12000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({ error: 'المساعد غير مهيأ بعد. أضف GEMINI_API_KEY إلى أسرار Cloudflare Pages.' }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'تعذر قراءة الرسالة. أعد المحاولة.' }, 400);
  }

  if (!Array.isArray(payload?.messages) || payload.messages.length === 0 || payload.messages.length > MAX_MESSAGES) {
    return json({ error: 'سجل المحادثة غير صالح أو طويل جداً.' }, 400);
  }

  const contents = [];
  for (const item of payload.messages) {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') {
      return json({ error: 'صيغة إحدى رسائل المحادثة غير صالحة.' }, 400);
    }
    const text = item.content.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) {
      return json({ error: 'إحدى الرسائل فارغة أو تتجاوز الحد المسموح.' }, 400);
    }
    contents.push({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text }] });
  }

  // Gemini expects alternating user/model turns. Skip malformed repeated roles defensively.
  const normalizedContents = [];
  for (const item of contents) {
    if (normalizedContents.at(-1)?.role === item.role) {
      normalizedContents[normalizedContents.length - 1].parts[0].text += `\n\n${item.parts[0].text}`;
    } else {
      normalizedContents.push(item);
    }
  }
  if (normalizedContents[0]?.role !== 'user') {
    return json({ error: 'ابدأ المحادثة برسالة من المستخدم ثم أعد المحاولة.' }, 400);
  }

  const model = (env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const baseUrl = (env.GEMINI_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

  let upstream;
  try {
    const url = new URL(endpoint);
    url.searchParams.set('key', apiKey);
    upstream = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: normalizedContents })
    });
  } catch {
    return json({ error: 'تعذر الوصول إلى خدمة Gemini. تحقق من اتصال الخدمة ثم حاول مجدداً.' }, 502);
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    return json({ error: 'أعادت خدمة Gemini استجابة غير مفهومة.' }, 502);
  }

  if (!upstream.ok) {
    const status = upstream.status;
    if (status === 400) return json({ error: 'رفض Gemini الطلب. تحقق من الرسالة وإعداد النموذج.' }, 400);
    if (status === 401 || status === 403) return json({ error: 'مفتاح Gemini غير صالح أو لا يملك صلاحية استخدام النموذج.' }, 502);
    if (status === 429) return json({ error: 'تم تجاوز حد الاستخدام مؤقتاً. انتظر قليلاً ثم حاول مجدداً.' }, 429);
    return json({ error: 'واجه Gemini مشكلة مؤقتة. حاول مرة أخرى لاحقاً.' }, 502);
  }

  const reply = result?.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim();

  if (!reply) {
    const wasBlocked = result?.promptFeedback?.blockReason;
    return json({
      error: wasBlocked
        ? 'لم يتمكن Gemini من معالجة هذا الطلب. أعد صياغته بطريقة مختلفة.'
        : 'لم يرجع Gemini نصاً للإجابة. حاول بصياغة أخرى.'
    }, 502);
  }

  return json({ reply });
}
