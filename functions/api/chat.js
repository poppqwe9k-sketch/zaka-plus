import { ThinkingLevel } from '@google/genai';
import { resolveTierConfig } from '../../src/shared/modelTiers.js';
import {
  clearGeminiKeyFailureState,
  createGeminiClient,
  getGeminiApiKeys,
  getServerQuotaSnapshot,
  isAuthKeyError,
  isKeyRotationEligibleError,
  isQuotaExhaustedError,
  markGeminiKeyCooldown,
  rotateGeminiKeys,
  sanitizeSecretFromErrorMessage
} from '../lib/geminiKeys.js';

const MAX_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};

const THINKING_ENUM_BY_KEY = {
  LOW: ThinkingLevel.LOW,
  MEDIUM: ThinkingLevel.MEDIUM,
  HIGH: ThinkingLevel.HIGH,
  XHIGH: ThinkingLevel.XHIGH
};

// Cache models that return 404/deprecated on this API key during process lifetime.
const UNAVAILABLE_MODELS = new Set();

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function validateMessages(value) {
  if (!Array.isArray(value) || value.length === 0) return { error: 'أرسل رسالة واحدة على الأقل.' };
  const messages = [];
  for (const item of value) {
    if (!item || !['user', 'assistant', 'model'].includes(item.role)) {
      return { error: 'صيغة إحدى رسائل المحادثة غير صالحة.' };
    }
    if (item.imageError) continue;
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!content) continue;
    if (content.length > MAX_MESSAGE_LENGTH) return { error: 'إحدى الرسائل تتجاوز الحد المسموح.' };
    const role = item.role === 'model' || item.role === 'assistant' ? 'assistant' : 'user';
    const prev = messages[messages.length - 1];
    if (prev && prev.role === role) {
      prev.content = `${prev.content}\n\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }
  while (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift();
  }
  if (messages.length === 0) return { error: 'أرسل رسالة واحدة على الأقل.' };
  const recentMessages = messages.slice(-MAX_MESSAGES);
  while (recentMessages.length > 0 && recentMessages[0].role !== 'user') {
    recentMessages.shift();
  }
  if (recentMessages.length === 0) return { error: 'يجب أن تبدأ المحادثة برسالة من المستخدم.' };
  return { messages: recentMessages };
}

function validateAttachments(value) {
  if (value === undefined) return { attachments: [] };
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return { error: `يمكن إرفاق ${MAX_ATTACHMENTS} ملفات كحد أقصى.` };
  const attachments = [];
  for (const item of value) {
    if (!item || typeof item.data !== 'string' || typeof item.mimeType !== 'string') return { error: 'بيانات أحد المرفقات غير صالحة.' };
    const match = item.data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || match[1].toLowerCase() !== item.mimeType.toLowerCase()) return { error: 'تعذر قراءة أحد المرفقات. أعد اختياره.' };
    const mimeType = item.mimeType.toLowerCase();
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') return { error: 'الملفات المرفقة المدعومة هي الصور وPDF.' };
    if (match[2].length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3)) return { error: 'حجم المرفق يتجاوز الحد الأقصى وهو 7 ميغابايت.' };
    attachments.push({ mimeType, data: match[2] });
  }
  return { attachments };
}

export function buildModelConfig(model, systemInstruction, tierConfig, isFallback = false) {
  if (typeof model === 'string' && (model.startsWith('gemini-4-') || model.startsWith('gemini-3'))) {
    let levelKey = tierConfig.thinkingLevel || 'LOW';
    if (levelKey === 'XHIGH' && model !== 'gemini-4-hydrogen' && model !== 'gemini-4-neon') {
      levelKey = 'HIGH';
    }
    return {
      ...(systemInstruction ? { systemInstruction } : {}),
      thinkingConfig: {
        thinkingLevel: THINKING_ENUM_BY_KEY[levelKey] || ThinkingLevel.LOW
      }
    };
  }

  const budget = isFallback
    ? (tierConfig.fallbackThinkingBudget ?? 0)
    : (tierConfig.thinkingBudget ?? 0);
  if (typeof budget === 'number' && budget >= 0) {
    return {
      systemInstruction,
      thinkingConfig: {
        thinkingBudget: budget
      }
    };
  }

  return { systemInstruction };
}

function isUnavailableModelError(error) {
  const status = typeof error?.status === 'number' ? error.status : 0;
  if (status === 404) return true;
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  return msg.includes('no longer available') || msg.includes('not_found') || msg.includes('not found');
}

function extractGeminiReplyText(response) {
  if (typeof response?.text === 'string' && response.text.trim()) {
    return response.text.trim();
  }
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const joined = parts
      .filter((part) => part && typeof part.text === 'string' && part.thought !== true)
      .map((part) => part.text)
      .join('')
      .trim();
    if (joined) return joined;
  }
  return '';
}

function buildEmptyResponseError(response) {
  const blockReason = response?.promptFeedback?.blockReason;
  const finishReason = response?.candidates?.[0]?.finishReason;
  if (blockReason) {
    return new Error(`تم حجب الرد من Gemini بسبب: ${blockReason}`);
  }
  if (finishReason && finishReason !== 'STOP') {
    return new Error(`لم يُرجع Gemini إجابة نصية (finishReason: ${finishReason}).`);
  }
  return new Error('لم يُرجع Gemini إجابة نصية.');
}

export async function runGeminiTier(env, messages, attachments, systemInstruction, tierConfig, generateFn = null) {
  const isCustomGenerateFn = typeof generateFn === 'function';
  const configuredKeys = getGeminiApiKeys(env);
  if (!isCustomGenerateFn && configuredKeys.length === 0) {
    throw new Error('لم يتم العثور على مفاتيح GEMINI_KEY أو GEMINI_KEY_1..19 أو GEMINI_KEYS على الخادم.');
  }

  const currentModel = tierConfig.model || 'gemini-4-hydrogen';
  const rotatedKeys = rotateGeminiKeys(env, currentModel);
  const keyPool = rotatedKeys.length > 0 ? rotatedKeys : ['test-key'];

  const contents = messages.map(({ role, content }) => ({
    role: role === 'assistant' ? 'model' : 'user',
    parts: [{ text: content }]
  }));

  if (attachments.length) {
    let lastUserIndex = -1;
    for (let index = contents.length - 1; index >= 0; index -= 1) {
      if (contents[index].role === 'user') {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) throw new Error('يجب إرفاق الملفات مع رسالة من المستخدم.');
    contents[lastUserIndex].parts.push(
      ...attachments.map(({ mimeType, data }) => ({ inlineData: { mimeType, data } }))
    );
  }

  const config = buildModelConfig(currentModel, systemInstruction, tierConfig, false);
  const activeKeyPool = keyPool;
  const quota429Keys = new Set();
  const authInvalidKeys = new Set();
  const attemptedKeys = new Set();

  const buildRequestQuotaMeta = (succeeded) => {
    const base = getServerQuotaSnapshot(env, currentModel);
    const validKeyCount = isCustomGenerateFn
      ? Math.max(0, base.validKeyCount - authInvalidKeys.size)
      : base.validKeyCount;
    const exhaustedKeyCount = isCustomGenerateFn
      ? Math.min(validKeyCount, Math.max(base.exhaustedKeyCount, quota429Keys.size))
      : base.exhaustedKeyCount;
    const healthyKeyCount = Math.max(0, validKeyCount - exhaustedKeyCount);
    const totalCapacity = validKeyCount * base.quotaPerKey;
    const maxRemainingFromHealthyKeys = healthyKeyCount * base.quotaPerKey;
    return {
      ...base,
      validKeyCount,
      exhaustedKeyCount,
      healthyKeyCount,
      totalCapacity,
      maxRemainingFromHealthyKeys,
      quota429ThisRequest: quota429Keys.size,
      authFailedThisRequest: authInvalidKeys.size,
      attemptedKeyCount: attemptedKeys.size,
      reachedModel: attemptedKeys.size > 0,
      succeeded
    };
  };

  let lastError;
  for (let keyIndex = 0; keyIndex < activeKeyPool.length; keyIndex += 1) {
    const activeKey = activeKeyPool[keyIndex];
    const hasNextKey = keyIndex < activeKeyPool.length - 1;
    const invokeGenerate = isCustomGenerateFn
      ? generateFn
      : (params) => createGeminiClient(activeKey).models.generateContent(params);

    const maxAttempts = hasNextKey ? 1 : 2;

    const perKeyTimeoutMs = tierConfig.thinkingLevel === 'XHIGH' ? 25000 : 15000;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        attemptedKeys.add(activeKey);
        const invokePromise = invokeGenerate({
          model: currentModel,
          contents,
          config,
          ...(isCustomGenerateFn ? { apiKey: activeKey } : {})
        });
        const response = isCustomGenerateFn
          ? await invokePromise
          : await Promise.race([
              invokePromise,
              new Promise((_, reject) => setTimeout(() => {
                const err = new Error('انتهت مهلة استجابة المفتاح الحالي.');
                err.status = 504;
                reject(err);
              }, perKeyTimeoutMs))
            ]);

        const reply = extractGeminiReplyText(response);
        if (!reply) {
          throw buildEmptyResponseError(response);
        }
        if (!isCustomGenerateFn && activeKey) {
          clearGeminiKeyFailureState(activeKey, currentModel);
        }
        return {
          reply,
          usedModel: currentModel,
          usedFallback: false,
          quotaMeta: buildRequestQuotaMeta(true)
        };
      } catch (error) {
        lastError = error;

        const status = typeof error?.status === 'number' ? error.status : 0;

        if (isQuotaExhaustedError(error) && activeKey) {
          quota429Keys.add(activeKey);
        }
        if (isAuthKeyError(error) && activeKey) {
          authInvalidKeys.add(activeKey);
        }
        if (isKeyRotationEligibleError(error) && !isCustomGenerateFn && activeKey) {
          markGeminiKeyCooldown(activeKey, error, currentModel);
        }

        if (hasNextKey) {
          break;
        }

        if (attempt < maxAttempts - 1 && (status === 503 || status === 504)) {
          await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
          continue;
        }

        if (error && typeof error === 'object') {
          error.triedKeys = activeKeyPool.length;
          error.quotaMeta = buildRequestQuotaMeta(false);
        }
        throw error;
      }
    }
  }

  if (lastError && typeof lastError === 'object') {
    lastError.triedKeys = activeKeyPool.length;
    lastError.quotaMeta = buildRequestQuotaMeta(false);
  }
  throw lastError || new Error('تعذر الاتصال بنموذج Gemini.');
}

function formatGeminiErrorMessage(error) {
  const raw = error instanceof Error
    ? error.message
    : (typeof error === 'string' ? error : JSON.stringify(error || ''));
  const text = (raw || '').trim();
  if (!text) return 'حدث خطأ غير معروف من خادم Gemini API.';
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.error?.message === 'string' && parsed.error.message.trim()) {
      const code = parsed?.error?.code ? ` (${parsed.error.code})` : '';
      return sanitizeSecretFromErrorMessage(`${parsed.error.message.trim()}${code}`);
    }
  } catch {
    // Use raw message if not JSON.
  }
  return sanitizeSecretFromErrorMessage(text);
}

export async function handleChat(request, env, generateFn = null) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'يرجى استخدام POST لإرسال الرسائل.' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'تعذر قراءة الطلب؛ يجب أن يكون JSON صالحاً.' }, 400);
  }

  const validation = validateMessages(body?.messages);
  if (validation.error) return json({ error: validation.error }, 400);

  const attachmentValidation = validateAttachments(body?.attachments);
  if (attachmentValidation.error) return json({ error: attachmentValidation.error }, 400);

  const systemInstruction = typeof body?.systemInstruction === 'string' && body.systemInstruction.trim()
    ? body.systemInstruction.trim().slice(0, 3000)
    : undefined;

  const defaultModeOrModel = env?.GEMINI_MODE || env?.GEMINI_MODEL;
  const tierConfig = resolveTierConfig(body?.selectedModel || defaultModeOrModel, Boolean(body?.deepThinking));

  try {
    const { reply, usedModel, usedFallback, quotaMeta } = await runGeminiTier(
      env,
      validation.messages,
      attachmentValidation.attachments,
      systemInstruction,
      tierConfig,
      generateFn
    );
    return json({
      reply,
      model: usedModel,
      requestedModel: tierConfig.model,
      usedFallback,
      tierId: tierConfig.tierId,
      modelName: tierConfig.labelAr,
      modelNameEn: tierConfig.labelEn,
      thinkingLevel: tierConfig.thinkingLevel,
      quotaMeta
    });
  } catch (error) {
    const status = typeof error?.status === 'number' && error.status >= 400 ? error.status : 502;
    const message = formatGeminiErrorMessage(error);
    const triedKeys = typeof error?.triedKeys === 'number' ? error.triedKeys : undefined;
    const quotaMeta = error?.quotaMeta || {
      ...getServerQuotaSnapshot(env, tierConfig.model),
      quota429ThisRequest: 0,
      authFailedThisRequest: 0,
      attemptedKeyCount: 0,
      reachedModel: false,
      succeeded: false
    };
    return json({
      error: triedKeys && triedKeys > 1 ? `${message} (بعد تجربة ${triedKeys} مفاتيح)` : message,
      triedKeys,
      model: tierConfig.model,
      tierId: tierConfig.tierId,
      modelName: tierConfig.labelAr,
      quotaMeta
    }, status === 400 || status === 401 || status === 403 || status === 429 || status === 503 ? status : 502);
  }
}

export async function onRequestPost({ request, env = {}, generateFn = null }) {
  try {
    return await handleChat(request, env, generateFn);
  } catch {
    return json({ error: 'حدث خطأ داخلي أثناء معالجة المحادثة. أعد المحاولة لاحقاً.' }, 502);
  }
}
