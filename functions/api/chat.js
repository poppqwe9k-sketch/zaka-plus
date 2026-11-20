const DEFAULT_MODEL = 'gemini-2.5-flash';
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

function safeProviderMessage(result, apiKey) {
  const message = result?.error?.message;
  if (typeof message !== 'string' || !message.trim()) return '';
  return message.replaceAll(apiKey, '[redacted]').slice(0, 700);
}

function normalizeModel(value, fallback) {
  const model = typeof value === 'string' ? value.trim() : '';
  return (model || fallback).replace(/^models\//, '');
}

function getProviderError(response, result, model, baseUrl, apiKey) {
  const details = safeProviderMessage(result, apiKey)
    || response.statusText
    || 'لا ت��جد تفاصيل إضافية من Gemini.';
  const apiVersion = baseUrl.split('/').pop();
  return {
    error: `فشل طلب Gemini (HTTP ${response.status}) للنموذج "${model}" عبر ${apiVersion}: ${details}`,
    model,
    apiVersion,
    providerStatus: result?.error?.status || null
  };
}

async function requestModel({ model, apiKey, baseUrl, contents }) {
  let endpoint;
  try {
    endpoint = new URL(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`);
  } catch {
    return { error: { error: 'عنوان Gemini API غير صالح. تحقق من GEMINI_API_BASE_URL.' }, status: 500 };
  }

  let lastResponse;
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
    try {
      lastResponse = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({ contents })
      });
    } catch {
      return {
        error: { error: 'تعذر الاتصال بخدمة Gemini. تحقق من اتصال Worker وحاول مجدداً.', model },
        status: 502
      };
    }

    if (lastResponse.status !== 503 || attempt === MAX_ATTEMPTS_PER_MODEL - 1) break;

    // Brief exponential backoff with jitter; keep the Worker request bounded.
    const delay = 250 * (2 ** attempt) + Math.floor(Math.random() * 200);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  let result;
  try {
    result = await lastResponse.json();
  } catch {
    return {
      error: {
        error: `أعادت Gemini استجابة غير صالحة (HTTP ${lastResponse.status}) للنموذج "${model}".`,
        model,
        apiVersion: baseUrl.split('/').pop()
      },
      status: 502
    };
  }

  if (!lastResponse.ok) {
    const status = lastResponse.status;
    const outputStatus = [400, 401, 403, 404, 429, 503].includes(status) ? status : 502;
    return {
      error: getProviderError(lastResponse, result, model, baseUrl, apiKey),
      status: outputStatus,
      upstreamStatus: status
    };
  }

  const reply = result?.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim();

  if (!reply) {
    const wasBlocked = result?.promptFeedback?.blockReason;
    return {
      error: {
        error: wasBlocked
          ? 'لم يتمكن Gemini من معالجة هذا الطلب. أعد صياغته بطريقة مختلفة.'
          : `أعاد Gemini استجابة ناجحة للنموذج "${model}" لكنها لا تحتوي على نص.`,
        model
      },
      status: 502
    };
  }

  return { reply, model };
}

export async function onRequestPost({ request, env = {} }) {
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

  const primaryModel = normalizeModel(env.GEMINI_MODEL, DEFAULT_MODEL);
  const fallbackModel = normalizeModel(env.GEMINI_FALLBACK_MODEL, DEFAULT_FALLBACK_MODEL);
  const configuredBaseUrl = typeof env.GEMINI_API_BASE_URL === 'string'
    ? env.GEMINI_API_BASE_URL.trim()
    : '';
  const baseUrl = (configuredBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');

  const primary = await requestModel({
    model: primaryModel,
    apiKey,
    baseUrl,
    contents: normalizedContents
  });
  if (primary.reply) return json(primary);

  // Retry only transient service-unavailable errors on a secondary model.
  // Do not conceal authentication, quota, invalid request, or model-name errors.
  if (primary.upstreamStatus === 503 && fallbackModel !== primaryModel) {
    const fallback = await requestModel({
      model: fallbackModel,
      apiKey,
      baseUrl,
      contents: normalizedContents
    });
    if (fallback.reply) return json({ ...fallback, fallbackUsed: true });

    return json({
      error: `النموذج الأساسي "${primaryModel}" غير متاح مؤقتاً (HTTP 503)، كما تعذر النموذج البديل "${fallbackModel}": ${fallback.error?.error || 'خطأ غير معروف.'}`,
      model: primaryModel,
      fallbackModel,
      fallbackStatus: fallback.upstreamStatus || fallback.status
    }, fallback.status || 502);
  }

  return json(primary.error || { error: 'تعذر إكمال الطلب إلى Gemini.' }, primary.status || 502);
}
