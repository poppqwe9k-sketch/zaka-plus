import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { resolveTierConfig } from '../../src/shared/modelTiers.js';

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
      systemInstruction,
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

function isQuotaOrFallbackEligibleError(error) {
  const status = typeof error?.status === 'number' ? error.status : 0;
  if (status === 429 || status === 404 || status === 503 || status === 504) return true;
  if (isUnavailableModelError(error)) return true;
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  return msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('429');
}

export async function runGeminiTier(env, messages, attachments, systemInstruction, tierConfig, generateFn = null) {
  const isCustomGenerateFn = typeof generateFn === 'function';
  let invokeGenerate = generateFn;
  if (!invokeGenerate) {
    const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
    if (!apiKey) {
      throw new Error('لم يتم العثور على مفتاح GEMINI_API_KEY على الخادم.');
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
    invokeGenerate = (params) => ai.models.generateContent(params);
  }

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

  const rawCandidates = [
    tierConfig.model,
    ...(Array.isArray(tierConfig.fallbackModels) ? tierConfig.fallbackModels : [tierConfig.fallbackModel])
  ].filter((m, idx, arr) => typeof m === 'string' && m && arr.indexOf(m) === idx);

  const candidateModels = isCustomGenerateFn
    ? rawCandidates
    : rawCandidates.filter((m) => !UNAVAILABLE_MODELS.has(m));
  const finalCandidates = candidateModels.length ? candidateModels : rawCandidates;

  let lastError;
  for (let modelIndex = 0; modelIndex < finalCandidates.length; modelIndex += 1) {
    const currentModel = finalCandidates[modelIndex];
    const isFallback = currentModel !== tierConfig.model;
    const hasNextFallback = modelIndex < finalCandidates.length - 1;
    const config = buildModelConfig(currentModel, systemInstruction, tierConfig, isFallback);
    const maxAttempts = hasNextFallback ? 1 : 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const generatePromise = invokeGenerate({
          model: currentModel,
          contents,
          config
        });
        const response = hasNextFallback && !isCustomGenerateFn
          ? await Promise.race([
              generatePromise,
              new Promise((_, reject) => setTimeout(() => {
                const timeoutErr = new Error('Primary model timed out');
                timeoutErr.status = 504;
                reject(timeoutErr);
              }, 12000))
            ])
          : await generatePromise;

        const reply = typeof response?.text === 'string' ? response.text.trim() : '';
        if (!reply) {
          throw new Error('لم يُرجع Gemini إجابة نصية.');
        }
        return {
          reply,
          usedModel: currentModel,
          usedFallback: isFallback
        };
      } catch (error) {
        lastError = error;
        if (!isCustomGenerateFn && isUnavailableModelError(error)) {
          UNAVAILABLE_MODELS.add(currentModel);
        }
        if (hasNextFallback && isQuotaOrFallbackEligibleError(error)) {
          break;
        }
        const status = typeof error?.status === 'number' ? error.status : 0;
        const isTransient = status === 503 || status === 504;
        if (!isTransient || attempt === maxAttempts - 1) {
          if (!hasNextFallback) {
            throw error;
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('تعذر الاتصال بنموذج Gemini.');
}

function formatGeminiErrorMessage(error) {
  const raw = error instanceof Error ? error.message : 'تعذر الاتصال بنموذج Gemini.';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
  } catch {
    // Use raw message if not JSON.
  }
  return raw;
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
    : 'أنت مساعد ذكاء بلس | Zaka+. أجب بدقة ووضوح وباللغة التي يطلبها المستخدم. ركّز على آخر طلب للمستخدم، ولا تكتب أبداً أكواد أدوات أو JSON مثل dalle.text2im.';

  const tierConfig = resolveTierConfig(body?.selectedModel, Boolean(body?.deepThinking));

  try {
    const { reply, usedModel, usedFallback } = await runGeminiTier(
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
      thinkingLevel: tierConfig.thinkingLevel
    });
  } catch (error) {
    const status = typeof error?.status === 'number' && error.status >= 400 ? error.status : 502;
    const message = formatGeminiErrorMessage(error);
    return json({
      error: message,
      model: tierConfig.model,
      tierId: tierConfig.tierId,
      modelName: tierConfig.labelAr
    }, status === 400 || status === 403 || status === 429 || status === 503 ? status : 502);
  }
}

export async function onRequestPost({ request, env = {}, generateFn = null }) {
  try {
    return await handleChat(request, env, generateFn);
  } catch {
    return json({ error: 'حدث خطأ داخلي أثناء معالجة المحادثة. أعد المحاولة لاحقاً.' }, 502);
  }
}
