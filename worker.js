const GEMINI_MODEL_POOL = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite'
];
const GEMINI_API_VERSION = 'v1beta';
const GEMINI_TIMEOUT_MS = 12000;
const PROVIDER_TIMEOUT_MS = 15000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_MESSAGE_LENGTH = 12000;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};
const WORKERS_AI_MODELS = {
  'deepseek-v4-flash': '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  llama: '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
};
const ANTHROPIC_MODEL = 'claude-sonnet-5-5';

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
  return Array.isArray(parts) ? parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim() : '';
}

async function callGemini({ apiKey, model, messages, systemInstruction }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
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
    if (!response.ok) return { ok: false, status: response.status, model, error: data?.error?.message || `Gemini API returned HTTP ${response.status}.` };
    const reply = extractGeminiText(data);
    return reply ? { ok: true, reply, model } : { ok: false, status: 502, model, error: 'Gemini returned an empty response.' };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === 'AbortError' ? 504 : 502,
      model,
      error: error?.name === 'AbortError' ? 'Gemini request timed out.' : 'Could not connect to Gemini.'
    };
  } finally {
    clearTimeout(timer);
  }
}

async function answerWithGemini(env, messages, body) {
  const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) return jsonResponse({ error: 'Gemini is not configured: add GEMINI_API_KEY as a Worker secret.' }, 503);

  const requested = typeof body?.model === 'string' && body.model.startsWith('gemini-') ? body.model : GEMINI_MODEL_POOL[0];
  const supplied = Array.isArray(body?.models) ? body.models : [];
  const candidates = [...new Set([requested, ...supplied, ...GEMINI_MODEL_POOL].filter((model) => GEMINI_MODEL_POOL.includes(model)))];
  let lastResult;

  for (let index = 0; index < candidates.length; index += 1) {
    const result = await callGemini({
      apiKey,
      model: candidates[index],
      messages,
      systemInstruction: typeof body?.systemInstruction === 'string'
        ? body.systemInstruction
        : 'You are Zaka+, a helpful assistant. Respond clearly in Arabic unless asked otherwise.'
    });
    if (result.ok) {
      return jsonResponse({ reply: result.reply, model: result.model, provider: 'gemini', fallbackUsed: index > 0 });
    }
    lastResult = result;
    if ([400, 401, 403].includes(result.status)) break;
  }

  const status = lastResult?.status >= 400 && lastResult.status < 600 ? lastResult.status : 502;
  return jsonResponse({
    error: `Gemini could not complete the request (${lastResult?.error || 'unknown provider error'}).`,
    model: lastResult?.model || requested,
    status
  }, status);
}

function extractWorkersAIText(result) {
  const value = result?.response ?? result?.result?.response ?? result?.choices?.[0]?.message?.content;
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((part) => typeof part === 'string' ? part : part?.text || '').join('').trim();
  return '';
}

async function callWorkersAI(env, model, messages, systemInstruction) {
  const binding = env?.MY_BINDING || env?.AI;
  if (!binding || typeof binding.run !== 'function') {
    return { ok: false, status: 503, error: 'Workers AI is unavailable: configure the MY_BINDING AI binding in Wrangler.' };
  }

  let timer;
  try {
    const result = await Promise.race([
      binding.run(model, {
        messages: [
          { role: 'system', content: systemInstruction },
          ...messages.map(({ role, content }) => ({ role, content }))
        ]
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Workers AI request timed out.')), PROVIDER_TIMEOUT_MS);
      })
    ]);
    const reply = extractWorkersAIText(result);
    return reply ? { ok: true, reply, model } : { ok: false, status: 502, error: `${model} returned an empty response.` };
  } catch (error) {
    return { ok: false, status: 502, error: error?.message || `Workers AI request failed for ${model}.` };
  } finally {
    clearTimeout(timer);
  }
}

async function callClaude(env, messages, systemInstruction) {
  const apiKey = typeof env?.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY.trim() : '';
  if (!apiKey) {
    return { ok: false, status: 503, error: 'Claude Sonnet 5.5 is not configured: add ANTHROPIC_API_KEY as a Worker secret.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        system: systemInstruction,
        messages: messages.map(({ role, content }) => ({ role, content }))
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, error: data?.error?.message || `Anthropic API returned HTTP ${response.status}.` };
    }
    const reply = Array.isArray(data?.content)
      ? data.content.filter((part) => part.type === 'text').map((part) => part.text || '').join('').trim()
      : '';
    return reply ? { ok: true, reply, model: ANTHROPIC_MODEL } : { ok: false, status: 502, error: 'Claude Sonnet 5.5 returned an empty response.' };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === 'AbortError' ? 504 : 502,
      error: error?.name === 'AbortError' ? 'Claude request timed out.' : 'Could not connect to the Anthropic API.'
    };
  } finally {
    clearTimeout(timer);
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

  const model = typeof body?.model === 'string' ? body.model : 'gemini';
  const systemInstruction = typeof body?.systemInstruction === 'string'
    ? body.systemInstruction
    : 'You are Zaka+, a helpful assistant. Respond clearly in Arabic unless asked otherwise.';

  if (model === 'gemini' || model.startsWith('gemini-')) return answerWithGemini(env, messages, body);
  if (model === 'deepseek-v4-flash' || model === 'llama') {
    const modelId = WORKERS_AI_MODELS[model];
    const result = await callWorkersAI(env, modelId, messages, systemInstruction);
    return result.ok
      ? jsonResponse({ reply: result.reply, model, provider: 'workers-ai' })
      : jsonResponse({ error: result.error, model, status: result.status }, result.status);
  }
  if (model === 'claude-sonnet-5-5') {
    const result = await callClaude(env, messages, systemInstruction);
    return result.ok
      ? jsonResponse({ reply: result.reply, model: result.model, provider: 'anthropic' })
      : jsonResponse({ error: result.error, model: ANTHROPIC_MODEL, status: result.status }, result.status);
  }

  return jsonResponse({ error: 'The selected model is not supported.' }, 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      try {
        return await handleChat(request, env);
      } catch {
        return jsonResponse({ error: 'The chat request failed unexpectedly. Please try again.' }, 502);
      }
    }
    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
