import {
  createGeminiClient,
  getGeminiApiKeys,
  runWithRotatedGeminiKeys
} from '../lib/geminiKeys.js';

export const POLLINATIONS_IMAGE_BASE = 'https://image.pollinations.ai/prompt';
export const MYMEMORY_TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
export const DEFAULT_IMAGE_MODEL = 'flux';
export const PROMPT_QUALITY_SUFFIX = ', wide angle shot, high quality, detailed';
const IMAGE_PROMPT_MODELS = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const UNAVAILABLE_IMAGE_MODELS = new Set();

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

function appendQualitySuffix(promptText) {
  const normalized = String(promptText || '').replace(/[.،!]+$/u, '').trim();
  if (!normalized) return '';
  if (normalized.toLowerCase().includes('wide angle shot')) {
    return normalized;
  }
  return `${normalized}${PROMPT_QUALITY_SUFFIX}`;
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

  return appendQualitySuffix(translatedText);
}

function isUnavailableImageModelError(error) {
  const status = typeof error?.status === 'number' ? error.status : 0;
  if (status === 404) return true;
  const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return msg.includes('no longer available') || msg.includes('not_found') || msg.includes('not found');
}

export async function translatePromptWithGemini(userPrompt, {
  env = (typeof process !== 'undefined' && process.env ? process.env : {}),
  generateFn = null
} = {}) {
  const cleanPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (!cleanPrompt) return '';

  const keys = getGeminiApiKeys(env);
  if (keys.length === 0) return '';

  const isCustomGenerateFn = typeof generateFn === 'function';
  const candidates = isCustomGenerateFn
    ? IMAGE_PROMPT_MODELS
    : IMAGE_PROMPT_MODELS.filter((m) => !UNAVAILABLE_IMAGE_MODELS.has(m));
  const modelList = candidates.length ? candidates : IMAGE_PROMPT_MODELS;

  const systemInstruction = 'Translate and refine the user image request into ONE concise, vivid English text-to-image prompt. Preserve exact counts (e.g. "10 people"), subjects, and setting accurately. Output only the English prompt with no quotes or markdown.';

  for (const model of modelList) {
    try {
      const englishText = await runWithRotatedGeminiKeys(env, async ({ apiKey }) => {
        const invoke = isCustomGenerateFn
          ? () => generateFn({ model, prompt: cleanPrompt, apiKey, systemInstruction })
          : () => createGeminiClient(apiKey).models.generateContent({
              model,
              contents: [{ role: 'user', parts: [{ text: cleanPrompt }] }],
              config: { systemInstruction }
            });

        const response = isCustomGenerateFn
          ? await invoke()
          : await Promise.race([
              invoke(),
              new Promise((_, reject) => setTimeout(() => {
                const err = new Error('Image prompt translation timed out');
                err.status = 504;
                reject(err);
              }, 6000))
            ]);

        const text = typeof response?.text === 'string' ? response.text.trim() : '';
        if (!text) {
          throw new Error('Empty image prompt translation from Gemini');
        }
        return text.replace(/^["'`]+|["'`]+$/g, '').trim();
      }, { model });

      if (englishText) {
        return {
          promptModel: model,
          rawText: englishText,
          englishPrompt: appendQualitySuffix(englishText)
        };
      }
    } catch (error) {
      if (!isCustomGenerateFn && isUnavailableImageModelError(error)) {
        UNAVAILABLE_IMAGE_MODELS.add(model);
        continue;
      }
      if (isUnavailableImageModelError(error)) {
        continue;
      }
      continue;
    }
  }

  return null;
}

export async function generatePollinationsImage({
  prompt,
  env = (typeof process !== 'undefined' && process.env ? process.env : {}),
  fetchImpl = fetch,
  translatePrompt,
  generateFn = null,
  seed = Math.floor(Math.random() * 100000),
  model = DEFAULT_IMAGE_MODEL
}) {
  const cleanInput = typeof prompt === 'string' ? prompt.trim() : '';
  if (!cleanInput) {
    const err = new Error('يرجى كتابة وصف واضح للصورة.');
    err.status = 400;
    throw err;
  }

  let englishPrompt = '';
  let promptModel = null;
  let promptChars = 0;
  if (typeof translatePrompt === 'function') {
    englishPrompt = (await translatePrompt(cleanInput, fetchImpl)) || '';
  } else {
    const geminiResult = await translatePromptWithGemini(cleanInput, { env, generateFn });
    if (geminiResult && geminiResult.englishPrompt) {
      englishPrompt = geminiResult.englishPrompt;
      promptModel = geminiResult.promptModel || null;
      promptChars = cleanInput.length + (geminiResult.rawText ? geminiResult.rawText.length : 0);
    }
    if (!englishPrompt) {
      englishPrompt = await translatePromptWithMyMemory(cleanInput, fetchImpl);
    }
  }

  englishPrompt = (englishPrompt || appendQualitySuffix(cleanInput)).trim();
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
    model,
    ...(promptModel ? { promptModel, promptChars } : {})
  };
}

export async function onRequestPost({
  request,
  env = (typeof process !== 'undefined' && process.env ? process.env : {}),
  fetchImpl = fetch,
  translatePrompt,
  generateFn = null,
  seed
}) {
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
      env,
      fetchImpl,
      translatePrompt,
      generateFn,
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
