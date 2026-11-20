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

function getGeminiError(status) {
  if (status === 400) {
    return 'رفض Gemini صيغة الطلب. تحقق من سجل المحادثة وإعداد النموذج GEMINI_MODEL.';
  }
  if (status === 401) {
    return 'رفض Gemini مفتاح API. تحقق من قيمة Secret باسم GEMINI_API_KEY في إعدادات Worker ثم أعد النشر.';
  }
  if (status === 403) {
    return 'مفتاح Gemini لا يملك صلاحية الوصول. تحقق من تفعيل Gemini API ومن قيود المفتاح في Google AI Studio.';
  }
  if (status === 404) {
    return `لم يُعثر على نموذج Gemini المطلوب. النموذج الحالي هو ${DEFAULT_MODEL} افتراضياً؛ تحقق من توفره أو اضبط GEMINI_MODEL على اسم نموذج متاح.`;
  }
  if (status === 429) {
    return 'تم بلوغ حد طلبات Gemini أو الحصة المتاحة. انتظر قليلاً أو تحقق من الحصة وحدود الاستخدام في Google AI Studio.';
  }
  if (status >= 500) {
    return 'خدمة Gemini تواجه عطلاً مؤقتاً. حاول مرة أخرى لاحقاً.';
  }
  return 'تعذر إكمال الطلب إلى Gemini. تحقق من إعدادات النموذج والمفتاح ثم حاول مجدداً.';
}

export async function onRequestPost({ request, env = {} }) {
  // Worker Secrets are exposed as env bindings at runtime; never read this from client-side Vite env.
  const apiKey = typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) {
    return json({ error: 'المساعد غير مهيأ: أضف GEMINI_API_KEY كـ Secret إلى بيئة Worker المنشورة.' }, 503);
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

  // Gemini accepts alternating user/model turns. Merge consecutive turns defensively.
  const normalizedContents = [];
  for (const item of contents) {
    const previous = normalizedContents[normalizedContents.length - 1];
    if (previous?.role === item.role) {
      previous.parts[0].text += `\n\n${item.parts[0].text}`;
    } else {
      normalizedContents.push(item);
    }
  }
  if (normalizedContents[0]?.role !== 'user') {
    return json({ error: 'ابدأ المحادثة برسالة من المستخدم ثم أعد المحاولة.' }, 400);
  }

  const model = (typeof env.GEMINI_MODEL === 'string' && env.GEMINI_MODEL.trim())
    ? env.GEMINI_MODEL.trim()
    : DEFAULT_MODEL;
  const baseUrl = (typeof env.GEMINI_API_BASE_URL === 'string' && env.GEMINI_API_BASE_URL.trim())
    ? env.GEMINI_API_BASE_URL.trim().replace(/\/+$/, '')
    : DEFAULT_API_BASE_URL;

  let endpoint;
  try {
    endpoint = new URL(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`);
  } catch {
    return json({ error: 'عنوان Gemini API غير صالح. تحقق من GEMINI_API_BASE_URL.' }, 500);
  }

  let upstream;
  try {
    upstream = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Send the secret in a header rather than the URL to avoid URL/log leakage.
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({ contents: normalizedContents })
    });
  } catch {
    return json({ error: 'تعذر الاتصال بخدمة Gemini. تحقق من اتصال Worker وحاول مجدداً.' }, 502);
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    return json({ error: `أعادت Gemini استجابة غير صالحة (HTTP ${upstream.status}). حاول لاحقاً.` }, 502);
  }

  if (!upstream.ok) {
    // Keep API keys and raw provider details out of user-visible errors and logs.
    return json({ error: getGeminiError(upstream.status) }, upstream.status === 429 ? 429 : 502);
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
        : 'استقبل Worker رداً ناجحاً من Gemini لكنه لا يحتوي على نص. حاول بصياغة أخرى.'
    }, 502);
  }

  return json({ reply });
}
