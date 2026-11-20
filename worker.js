const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_MODEL_POOL = [
  DEFAULT_GEMINI_MODEL,
  'gemini-3.8-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite'
];
const GEMINI_API_VERSION = 'v1beta';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_MESSAGE_LENGTH = 12000;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function extractMessages(body) {
  let input = Array.isArray(body?.messages) ? body.messages.slice(-MAX_HISTORY_MESSAGES) : [];
  if (!input.length && typeof body?.message === 'string') input = [{ role: 'user', content: body.message }];
  if (!input.length && typeof body?.prompt === 'string') input = [{ role: 'user', content: body.prompt }];

  const messages = [];
  for (const item of input) {
    if (!item || !['user', 'assistant', 'model'].includes(item.role) || typeof item.content !== 'string') continue;
    const content = item.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) continue;
    messages.push({ role: item.role === 'model' ? 'assistant' : item.role, content });
  }
  return messages;
}

function toGeminiContents(messages) {
  const contents = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const previous = contents[contents.length - 1];
    if (previous?.role === role) previous.parts[0].text += `\n\n${message.content}`;
    else contents.push({ role, parts: [{ text: message.content }] });
  }
  return contents;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)
    ? parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim()
    : '';
}

async function callGemini({ apiKey, model, messages, systemInstruction }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const endpoint = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: toGeminiContents(messages),
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.7 }
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, model, error: data?.error?.message || `Gemini API returned HTTP ${response.status}.` };
    }
    const reply = extractGeminiText(data);
    return reply
      ? { ok: true, reply, model }
      : { ok: false, status: 502, model, error: 'Gemini returned an empty response.' };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === 'AbortError' ? 504 : 502,
      model,
      error: error?.name === 'AbortError' ? 'Gemini request timed out.' : 'Could not connect to Gemini.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleChat(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST to send chat messages.' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }

  const messages = extractMessages(body);
  if (!messages.length) return jsonResponse({ error: 'Please enter a message before sending.' }, 400);
  if (messages[0].role !== 'user') return jsonResponse({ error: 'The first message must be from the user.' }, 400);

  const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) {
    return jsonResponse({ error: 'Gemini is not configured. Add GEMINI_API_KEY as a Worker secret.' }, 503);
  }

  const requestedModel = typeof body?.model === 'string' ? body.model.trim() : '';
  const model = GEMINI_MODEL_POOL.includes(requestedModel) ? requestedModel : DEFAULT_GEMINI_MODEL;
  const candidates = [model, ...GEMINI_MODEL_POOL.filter((candidate) => candidate !== model)];
  const systemInstruction = typeof body?.systemInstruction === 'string' && body.systemInstruction.trim()
    ? body.systemInstruction.trim()
    : 'You are Zaka+, a helpful assistant. Respond clearly in Arabic unless asked otherwise.';
  let lastResult;

  for (const candidate of candidates) {
    const result = await callGemini({ apiKey, model: candidate, messages, systemInstruction });
    if (result.ok) {
      return jsonResponse({ reply: result.reply, model: result.model, provider: 'gemini', fallbackUsed: candidate !== model });
    }
    lastResult = result;
    if ([400, 401, 403].includes(result.status)) break;
  }

  const status = lastResult?.status >= 400 && lastResult.status < 600 ? lastResult.status : 502;
  return jsonResponse({
    error: `Gemini could not complete the request (${lastResult?.error || 'all configured Gemini models failed'}).`,
    model: lastResult?.model || model,
    status
  }, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      try {
        return await handleChat(request, env);
      } catch {
        return jsonResponse({ error: 'An unexpected error occurred while processing the chat request. Please try again.' }, 502);
      }
    }
    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
