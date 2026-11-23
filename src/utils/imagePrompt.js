export const IMAGE_REQUEST_PATTERN = /(?:^|\s)(?:ارسم(?:لي|\s+لي)?|صمم(?:\s+لي)?\s+صورة|ولد(?:\s+لي)?\s+صورة|أنشئ(?:\s+لي)?\s+صورة|انشئ(?:\s+لي)?\s+صورة|اصنع(?:\s+لي)?\s+صورة|(?:أعطني|اعطني|أريد|اريد|هات)\s+صورة|(?:توليد|إنشاء|انشاء)\s+صورة|generate\s+(?:an?\s+)?image|create\s+(?:an?\s+)?image|draw\s+(?:me\s+)?(?:an?\s+)?(?:image|picture))(?:\s|$)|^صورة(?:\s+لي|\s+ل)?\s+/i;

const MYMEMORY_TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
const PROMPT_QUALITY_SUFFIX = ', wide angle shot, high quality, detailed';

export function isImageGenerationRequest(text) {
  return typeof text === 'string' && IMAGE_REQUEST_PATTERN.test(text.trim());
}

export function buildPollinationsImageUrl(englishPrompt, {
  width = 768,
  height = 768,
  model = 'flux',
  nologo = true,
  seed = Math.floor(Math.random() * 100000)
} = {}) {
  const cleanPrompt = typeof englishPrompt === 'string' ? englishPrompt.trim() : '';
  const safeSeed = Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : Math.floor(Math.random() * 100000);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=${width}&height=${height}&model=${encodeURIComponent(model)}&nologo=${nologo ? 'true' : 'false'}&seed=${safeSeed}`;
}

export async function translateArabicPromptFree(prompt, fetchImpl = fetch) {
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!cleanPrompt) return '';

  const hasArabic = /[\u0600-\u06FF]/.test(cleanPrompt);
  let translatedText = cleanPrompt;

  if (hasArabic) {
    try {
      const response = await fetchImpl(
        `${MYMEMORY_TRANSLATE_URL}?q=${encodeURIComponent(cleanPrompt)}&langpair=ar|en`,
        { method: 'GET' }
      );
      if (response.ok) {
        const data = await response.json().catch(() => null);
        const candidate = typeof data?.responseData?.translatedText === 'string'
          ? data.responseData.translatedText.trim()
          : '';
        if (candidate) translatedText = candidate;
      }
    } catch {
      // Fall back to original text if translation fails.
    }
  }

  return `${translatedText.replace(/[.،!]+$/u, '').trim()}${PROMPT_QUALITY_SUFFIX}`;
}

export async function generateImageViaApi(prompt, fetchImpl = fetch) {
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!cleanPrompt) {
    throw new Error('يرجى كتابة وصف واضح للصورة.');
  }

  try {
    const response = await fetchImpl('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: cleanPrompt })
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && typeof data?.imageUrl === 'string' && data.imageUrl) {
      return {
        imageUrl: data.imageUrl,
        englishPrompt: data.englishPrompt || cleanPrompt,
        seed: data.seed ?? Math.floor(Math.random() * 100000),
        model: data.model || 'flux'
      };
    }
  } catch {
    // Fall back to direct free MyMemory + Pollinations flow.
  }

  const englishPrompt = await translateArabicPromptFree(cleanPrompt, fetchImpl);
  const seed = Math.floor(Math.random() * 100000);
  return {
    imageUrl: buildPollinationsImageUrl(englishPrompt, { model: 'flux', seed }),
    englishPrompt,
    seed,
    model: 'flux'
  };
}
