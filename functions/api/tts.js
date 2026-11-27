import {
  createGeminiClient,
  runWithRotatedGeminiKeys,
  sanitizeSecretFromErrorMessage
} from '../lib/geminiKeys.js';
import { prepareTextForSpeech } from '../../src/utils/voiceCall.js';

const TTS_MODEL_ID = 'gemini-3.8-flash-lite-tts';
const ALLOWED_VOICES = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);

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
    const spokenText = prepareTextForSpeech(body?.text || '');
    if (!spokenText) {
      return json({ error: 'النص المطلوب تحويله إلى صوت فارغ.' }, 400);
    }

    const voiceName = ALLOWED_VOICES.has(body?.voiceName) ? body.voiceName : 'Kore';

    const audioBase64 = await runWithRotatedGeminiKeys(
      env,
      async ({ apiKey }) => {
        const ai = createGeminiClient(apiKey);
        const response = await ai.models.generateContent({
          model: TTS_MODEL_ID,
          contents: [
            {
              role: 'user',
              parts: [{ text: spokenText }]
            }
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName }
              }
            }
          }
        });
        const base64 = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64 || typeof base64 !== 'string') {
          throw new Error('لم يُرجع نموذج الصوت بيانات WAV صالحة.');
        }
        return base64;
      },
      { model: TTS_MODEL_ID }
    );

    return json({
      audioBase64,
      mimeType: 'audio/wav',
      model: TTS_MODEL_ID
    });
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : 'تعذر توليد الصوت حالياً.';
    return json({
      error: sanitizeSecretFromErrorMessage(rawMsg)
    }, 502);
  }
}
