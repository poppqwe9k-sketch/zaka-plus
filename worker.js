const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const DEFAULT_GEMINI_POOL = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite'
];
const GEMINI_API_VERSION = 'v1beta';
const MAX_HISTORY_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 12000;
const REQUEST_TIMEOUT_MS = 15000;
const WORKERS_AI_TIMEOUT_MS = 15000;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};
const WORKERS_AI_MODELS = {
  qwen: '@cf/qwen/qwen2.5-72b-instruct',
  deepseek: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  llama: '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function normalizeModelName(value, fallback = '') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const model = value.trim();
  return model.startsWith('models/') ? model.slice(7) : model;
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function callGemini({ apiKey, model, contents, systemInstruction, maxOutputTokens }) {
  const modelName = normalizeModelName(model, DEFAULT_GEMINI_MODEL);
  const endpoint = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${encodeURIComponent(modelName)}:generateContent`;
  const generationConfig = { temperature: 0.7 };
  if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = Math.min(maxOutputTokens, 8192);
  }

  const payload = { contents, generationConfig };
  if (typeof systemInstruction === 'string' && systemInstruction.trim()) {
    payload.systemInstruction = { parts: [{ text: systemInstruction.trim() }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        model: modelName,
        error: data?.error?.message || response.statusText || `HTTP ${response.status}`
      };
    }

    const reply = extractGeminiText(data);
    return reply
      ? { ok: true, status: 200, model: modelName, reply }
      : { ok: false, status: 502, model: modelName, error: 'Gemini returned no usable text.' };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      model: modelName,
      error: timedOut ? 'Gemini request timed out.' : 'Unable to reach Gemini temporarily.'
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildGeminiModelOrder(primaryModel, userModels, envModel) {
  const allowed = new Set(DEFAULT_GEMINI_POOL);
  const ordered = [];
  const seen = new Set();
  const add = (value) => {
    const model = normalizeModelName(value);
    if (!model || !allowed.has(model) || seen.has(model)) return;
    seen.add(model);
    ordered.push(model);
  };

  add(primaryModel);
  add(envModel);
  if (Array.isArray(userModels)) userModels.forEach(add);
  DEFAULT_GEMINI_POOL.forEach(add);
  return ordered.length ? ordered : [DEFAULT_GEMINI_MODEL];
}

async function runAcrossGeminiModels(options) {
  const models = buildGeminiModelOrder(options.primaryModel, options.userModels, options.envModel);
  let lastResult = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const attempts = index === 0 ? 2 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await callGemini({ ...options, model });
      if (result.ok) return { ...result, switchedFromPrimary: index > 0 };
      lastResult = result;
      if ([400, 401, 403].includes(result.status)) return result;
      if ([503, 504].includes(result.status) && attempt < attempts) {
        await sleep(350);
        continue;
      }
      break;
    }
  }

  return lastResult || {
    ok: false,
    status: 503,
    model: DEFAULT_GEMINI_MODEL,
    error: 'All Gemini models are temporarily unavailable.'
  };
}

function normalizeWorkersReply(output) {
  const content = output?.response ?? output?.result?.response ?? output?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : part?.text || '').join('').trim();
  return '';
}

async function tryWorkersAI({ env, messages, systemInstruction, model }) {
  const binding = env?.MY_BINDING || env?.AI;
  if (!binding || typeof binding.run !== 'function') return null;

  const modelId = model || (typeof env?.WORKERS_AI_MODEL === 'string' && env.WORKERS_AI_MODEL.trim()) || WORKERS_AI_MODELS.llama;
  let timer;
  try {
    const output = await Promise.race([
      binding.run(modelId, {
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          ...messages.map(({ role, content }) => ({ role, content }))
        ]
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Workers AI request timed out.')), WORKERS_AI_TIMEOUT_MS);
      })
    ]);
    const reply = normalizeWorkersReply(output);
    return reply ? { ok: true, status: 200, model: modelId, reply, switchedFromPrimary: true } : null;
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

  const systemInstruction = typeof body?.systemInstruction === 'string'
    ? body.systemInstruction
    : 'You are Zaka+, a helpful assistant. Respond clearly in Arabic unless asked otherwise.';
  const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  const requestedModel = typeof body?.model === 'string' ? body.model.trim() : '';
  const userModels = Array.isArray(body?.models) ? body.models : [];
  const envModel = typeof env?.GEMINI_MODEL === 'string' ? env.GEMINI_MODEL.trim() : '';
  const maxOutputTokens = Number.isFinite(body?.maxOutputTokens) ? body.maxOutputTokens : undefined;

  try {
    if (Object.hasOwn(WORKERS_AI_MODELS, requestedModel)) {
      const result = await tryWorkersAI({ env, messages, systemInstruction, model: WORKERS_AI_MODELS[requestedModel] });
      if (!result) return jsonResponse({ error: 'The selected Workers AI model is unavailable or not configured.' }, 503);
      return jsonResponse({ reply: result.reply, model: requestedModel, provider: 'workers-ai' });
    }

    if (!apiKey) {
      const fallback = await tryWorkersAI({ env, messages, systemInstruction });
      if (fallback?.ok) {
        return jsonResponse({ reply: fallback.reply, model: fallback.model, provider: 'workers-ai', switchedFromPrimary: true });
      }
      return jsonResponse({ error: 'GEMINI_API_KEY is not configured in the Cloudflare Worker.' }, 503);
    }

    const result = await runAcrossGeminiModels({
      apiKey,
      primaryModel: requestedModel.startsWith('gemini-') ? requestedModel : DEFAULT_GEMINI_MODEL,
      userModels,
      envModel,
      contents: toGeminiContents(messages),
      systemInstruction,
      maxOutputTokens
    });
    if (result.ok) {
      return jsonResponse({
        reply: result.reply,
        model: result.model,
        provider: 'gemini',
        switchedFromPrimary: Boolean(result.switchedFromPrimary)
      });
    }

    const fallback = await tryWorkersAI({ env, messages, systemInstruction });
    if (fallback?.ok) {
      return jsonResponse({ reply: fallback.reply, model: fallback.model, provider: 'workers-ai', switchedFromPrimary: true });
    }

    const status = result.status >= 400 && result.status < 600 ? result.status : 502;
    return jsonResponse({ error: `Gemini request failed (HTTP ${status}): ${result.error}`, model: result.model, status }, status);
  } catch {
    return jsonResponse({ error: 'An internal error occurred while processing the chat request.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') return handleChat(request, env);
    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
