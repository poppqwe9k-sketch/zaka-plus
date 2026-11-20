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

function safeProviderMessage(result, apiKey) {
  const message = result?.error?.message;
  if (typeof message !== 'string' || !message.trim()) return '';
  // Avoid accidentally returning a secret if the upstream error ever echoes it.
  return message.replaceAll(apiKey, '[redacted]').slice(0, 700);
}

export async function onRequestPost({ request, env = {} }) {
  // Cloudflare Worker secrets and vars are runtime bindings on env.
  const apiKey = typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) {
    return json({ error: 'المساعد غير مهيأ: تحقق من إضافة GEMINI_API_KEY كـ Secret إلى Worker المنشور.' }, 503);
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

  // Gemini expects turns to alternate between user and model. Merge adjacent
  // turns of the same role to keep the request valid if history is malformed.
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

  // Runtime vars are strings. Trim whitespace, and allow either a bare model
  // ID or the API's conventional `models/<id>` form.
  const configuredModel = typeof env.GEMINI_MODEL === 'string' ? env.GEMINI_MODEL.trim() : '';
  const model = (configuredModel || DEFAULT_MODEL).replace(/^models\//, '');
  const configuredBaseUrl = typeof env.GEMINI_API_BASE_URL === 'string'
    ? env.GEMINI_API_BASE_URL.trim()
    : '';
  const baseUrl = (configuredBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');

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
    return json({
      error: `أعادت Gemini استجابة غير صالحة (HTTP ${upstream.status}) للنموذج ${model}.`,
      model,
      apiVersion: baseUrl.split('/').pop()
    }, 502);
  }

  if (!upstream.ok) {
    const providerMessage = safeProviderMessage(result, apiKey);
    const apiVersion = baseUrl.split('/').pop();
    const details = providerMessage || upstream.statusText || 'لا توجد تفاصيل إضافية من Gemini.';
    const error = `فشل طلب Gemini (HTTP ${upstream.status}) للنموذج "${model}" عبر ${apiVersion}: ${details}`;
    // Preserve client/rate-limit status codes so the UI and diagnostics can identify them.
    const status = [400, 401, 403, 404, 429].includes(upstream.status) ? upstream.status : 502;
    return json({ error, model, apiVersion, providerStatus: result?.error?.status || null }, status);
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
        : `أعاد Gemini استجابة ناجحة للنموذج "${model}" لكنها لا تحتوي على نص.`,
      model
    }, 502);
  }

  return json({ reply, model });
}
