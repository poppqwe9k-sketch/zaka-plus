const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_ATTEMPTS_PER_MODEL = 2;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function normalizeModel(value, fallback) {
  const configured = typeof value === 'string' ? value.trim() : '';
  return (configured || fallback).replace(/^models\//, '');
}

function describeProviderError(response, payload, model, baseUrl, apiKey) {
  const rawMessage = payload?.error?.message;
  const detail = typeof rawMessage === 'string' && rawMessage.trim()
    ? rawMessage.replaceAll(apiKey, '[redacted]').slice(0, 700)
    : response.statusText || 'لا توجد تفاصيل إضافية من Gemini.';
  return {
    error: `فشل طلب Gemini (HTTP ${response.status}) للنموذج «${model}» عبر ${baseUrl.split('/').pop()}: ${detail}`,
    model,
    providerStatus: payload?.error?.status || null
  };
}

async function callModel({ model, apiKey, baseUrl, contents }) {
  let endpoint;
  try {
    endpoint = new URL(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`);
  } catch {
    return { ok: false, status: 502, message: 'عنوان Gemini API غير صالح. تحقق من GEMINI_API_BASE_URL.' };
  }

  let response;
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
    try {
      response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({ contents })
      });
    } catch {
      return { ok: false, status: 502, message: 'تعذر الاتصال بخدمة Gemini. تحقق من اتصال Worker وحاول مجدداً.' };
    }

    if (response.status !== 503 || attempt === MAX_ATTEMPTS_PER_MODEL - 1) break;
    const delay = 250 * (2 ** attempt) + Math.floor(Math.random() * 200);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      status: response.status === 503 ? 503 : 502,
      message: `أعادت Gemini استجابة غير صالحة (HTTP ${response.status}) للنموذج «${model}».`,
      upstreamStatus: response.status
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status === 503 ? 503 : 502,
      message: describeProviderError(response, payload, model, baseUrl, apiKey).error,
      upstreamStatus: response.status
    };
  }

  const reply = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim();

  if (!reply) {
    const reason = payload?.promptFeedback?.blockReason;
    return {
      ok: false,
      status: 502,
      message: reason
        ? 'لم يتمكن Gemini من معالجة هذا الطلب. أعد صياغته بطريقة مختلفة.'
        : `أعاد Gemini استجابة ناجحة للنموذج «${model}» لكنها لا تحتوي على نص.`
    };
  }

  return { ok: true, reply, model };
}

export async function onRequestPost({ request, env = {} }) {
  try {
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

    // Gemini expects alternating user/model turns. Merge adjacent turns defensively.
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

    const model = normalizeModel(env.GEMINI_MODEL, DEFAULT_MODEL);
    const fallbackModel = normalizeModel(env.GEMINI_FALLBACK_MODEL, DEFAULT_FALLBACK_MODEL);
    const configuredBase = typeof env.GEMINI_API_BASE_URL === 'string' ? env.GEMINI_API_BASE_URL.trim() : '';
    const baseUrl = (configuredBase || DEFAULT_API_BASE_URL).replace(/\/+$/, '');

    const primary = await callModel({ model, apiKey, baseUrl, contents: normalizedContents });
    if (primary.ok) return json({ reply: primary.reply, model: primary.model });

    if (primary.upstreamStatus === 503 && fallbackModel !== model) {
      const fallback = await callModel({ model: fallbackModel, apiKey, baseUrl, contents: normalizedContents });
      if (fallback.ok) {
        return json({ reply: fallback.reply, model: fallback.model, fallbackUsed: true });
      }
      return json({
        error: `النموذج الأساسي «${model}» غير متاح مؤقتاً بعد إعادة المحاولة. فشل النموذج الاحتياطي «${fallbackModel}»: ${fallback.message}`,
        model,
        fallbackModel,
        fallbackStatus: fallback.upstreamStatus || fallback.status
      }, fallback.status || 502);
    }

    return json({ error: primary.message || 'تعذر إكمال الطلب إلى Gemini.', model }, primary.status || 502);
  } catch {
    // Never let an unexpected handler exception become an opaque Worker HTTP 500.
    return json({ error: 'حدث خطأ داخلي أثناء معالجة طلب Gemini. أعد المحاولة، وإذا استمر العطل راجع سجلات Worker.' }, 502);
  }
}
