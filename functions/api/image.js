export const POLLINATIONS_IMAGE_BASE = 'https://image.pollinations.ai/prompt';
export const MYMEMORY_TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
export const DEFAULT_IMAGE_MODEL = 'flux';
export const PROMPT_QUALITY_SUFFIX = ', wide angle shot, high quality, detailed';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export function buildPollinationsUrl(englishPrompt, {
  width = 768,
  height = 768,
  model = DEFAULT_IMAGE_MODEL,
  nologo = true,
  seed = Math.floor(Math.random() * 100000)
} = {}) {
  const cleanPrompt = typeof englishPrompt === 'string' ? englishPrompt.trim() : '';
  const encodedPrompt = encodeURIComponent(cleanPrompt);
  const safeSeed = Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : Math.floor(Math.random() * 100000);
  return `${POLLINATIONS_IMAGE_BASE}/${encodedPrompt}?width=${width}&height=${height}&model=${encodeURIComponent(model)}&nologo=${nologo ? 'true' : 'false'}&seed=${safeSeed}`;
}

export async function translatePromptWithMyMemory(userPrompt, fetchImpl = fetch) {
  const cleanPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (!cleanPrompt) return '';

  const hasArabic = /[\u0600-\u06FF]/.test(cleanPrompt);
  let translatedText = cleanPrompt;

  if (hasArabic) {
    try {
      const url = `${MYMEMORY_TRANSLATE_URL}?q=${encodeURIComponent(cleanPrompt)}&langpair=ar|en`;
      const response = await fetchImpl(url, { method: 'GET' });
      if (response.ok) {
        const data = await response.json().catch(() => null);
        const candidate = typeof data?.responseData?.translatedText === 'string'
          ? data.responseData.translatedText.trim()
          : '';
        if (candidate) {
          translatedText = candidate;
        }
      }
    } catch {
      // Fall back to original prompt if translation service fails.
    }
  }

  const normalized = translatedText.replace(/[.،!]+$/u, '').trim();
  return `${normalized}${PROMPT_QUALITY_SUFFIX}`;
}

export async function generatePollinationsImage({
  prompt,
  fetchImpl = fetch,
  translatePrompt = translatePromptWithMyMemory,
  seed = Math.floor(Math.random() * 100000),
  model = DEFAULT_IMAGE_MODEL
}) {
  const cleanInput = typeof prompt === 'string' ? prompt.trim() : '';
  if (!cleanInput) {
    const err = new Error('يرجى كتابة وصف واضح للصورة.');
    err.status = 400;
    throw err;
  }

  const englishPrompt = ((await translatePrompt(cleanInput, fetchImpl)) || `${cleanInput}${PROMPT_QUALITY_SUFFIX}`).trim();
  const safeSeed = Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : Math.floor(Math.random() * 100000);
  const imageUrl = buildPollinationsUrl(englishPrompt, {
    width: 768,
    height: 768,
    model,
    nologo: true,
    seed: safeSeed
  });

  return {
    imageUrl,
    englishPrompt,
    seed: safeSeed,
    model
  };
}

export async function onRequestPost({ request, fetchImpl = fetch, translatePrompt, seed }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json({ error: 'يرجى استخدام POST لتوليد الصور.' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'تعذر قراءة الطلب؛ يجب أن يكون JSON صالحاً.' }, 400);
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 4000) {
    return json({ error: 'يرجى كتابة وصف مناسب للصورة.' }, 400);
  }

  try {
    const result = await generatePollinationsImage({
      prompt,
      fetchImpl,
      translatePrompt,
      seed
    });
    return json(result, 200);
  } catch (error) {
    const status = typeof error?.status === 'number' && error.status >= 400 ? error.status : 502;
    return json(
      {
        error: error instanceof Error ? error.message : 'تعذر توليد الصورة.'
      },
      status
    );
  }
}
