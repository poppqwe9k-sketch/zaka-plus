import {
  createGeminiClient,
  runWithRotatedGeminiKeys,
  sanitizeSecretFromErrorMessage
} from '../lib/geminiKeys.js';

const TRANSCRIBE_MODEL_ID = 'gemini-3.5-transcribe';
const MAX_AUDIO_BASE64_LEN = Math.ceil(8 * 1024 * 1024 * 4 / 3);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  try {
    if (request.method === 'OPTIONS') {
      return onRequestOptions();
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method Not Allowed' }, 405);
    }

    const body = await request.json().catch(() => null);
    const audioBase64 = typeof body?.audioBase64 === 'string' ? body.audioBase64.trim() : '';
    const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : '';

    if (!audioBase64 || !mimeType.startsWith('audio/')) {
      return json({ error: 'بيانات الصوت غير صالحة.' }, 400);
    }
    if (audioBase64.length > MAX_AUDIO_BASE64_LEN) {
      return json({ error: 'حجم المقطع الصوتي يتجاوز الحد المسموح.' }, 400);
    }

    const transcript = await runWithRotatedGeminiKeys(
      env,
      async ({ apiKey }) => {
        const ai = createGeminiClient(apiKey);
        const response = await ai.models.generateContent({
          model: TRANSCRIBE_MODEL_ID,
          contents: {
            parts: [
              { inlineData: { mimeType, data: audioBase64 } },
              { text: 'Transcribe the spoken audio accurately in its original language. Return only the transcription text without extra commentary.' }
            ]
          }
        });
        return typeof response?.text === 'string' ? response.text.trim() : '';
      },
      { model: TRANSCRIBE_MODEL_ID }
    );

    return json({ text: transcript, model: TRANSCRIBE_MODEL_ID });
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : 'تعذر تفريغ الصوت حالياً.';
    return json({
      error: sanitizeSecretFromErrorMessage(rawMsg)
    }, 502);
  }
}
