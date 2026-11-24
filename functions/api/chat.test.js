import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from './chat.js';

test('POST /api/chat always uses gemini-4-hydrogen regardless of selectedModel input', async () => {
  let captured = null;
  const req = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'مرحبا' }],
      selectedModel: 'plus'
    })
  });

  const res = await onRequestPost({
    request: req,
    env: { GEMINI_API_KEY: 'test-key' },
    generateFn: async ({ model, config }) => {
      captured = { model, config };
      return { text: 'أهلاً بك في ذكاء بلس!' };
    }
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reply, 'أهلاً بك في ذكاء بلس!');
  assert.equal(body.model, 'gemini-4-hydrogen');
  assert.equal(captured.model, 'gemini-4-hydrogen');
  assert.equal(captured.config.thinkingConfig.thinkingLevel, 'LOW');
});

test('POST /api/chat enables XHIGH thinking level when deepThinking is true', async () => {
  let captured = null;
  const req = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'حلل هذه الفكرة بعمق' }],
      deepThinking: true
    })
  });

  const res = await onRequestPost({
    request: req,
    env: { GEMINI_API_KEY: 'test-key' },
    generateFn: async ({ model, config }) => {
      captured = { model, config };
      return { text: 'تحليل عميق' };
    }
  });

  assert.equal(res.status, 200);
  assert.equal(captured.model, 'gemini-4-hydrogen');
  assert.equal(captured.config.thinkingConfig.thinkingLevel, 'XHIGH');
});

test('rotates silently across GEMINI_KEY_1..GEMINI_KEY_19 on 429 Quota exceeded / Resource has been exhausted', async () => {
  const { resetKeyRotationForTests } = await import('../lib/geminiKeys.js');
  resetKeyRotationForTests();

  const env = {};
  for (let i = 1; i <= 19; i += 1) {
    env[`GEMINI_KEY_${i}`] = `key-${i}`;
  }

  const seenKeys = [];
  const req = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'مرحبا' }]
    })
  });

  const res = await onRequestPost({
    request: req,
    env,
    generateFn: async ({ model, apiKey }) => {
      seenKeys.push(`${model}:${apiKey}`);
      if (apiKey !== 'key-19') {
        const err = new Error('Resource has been exhausted (429 Quota exceeded)');
        err.status = 429;
        throw err;
      }
      return { text: 'تم الرد بصمت عبر المفتاح 19 على gemini-4-hydrogen' };
    }
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.model, 'gemini-4-hydrogen');
  assert.equal(body.reply, 'تم الرد بصمت عبر المفتاح 19 على gemini-4-hydrogen');
  assert.equal(seenKeys.length, 19);
  assert.equal(seenKeys[0], 'gemini-4-hydrogen:key-1');
  assert.equal(seenKeys[18], 'gemini-4-hydrogen:key-19');
});

test('rotates across GEMINI_KEY (no 1) and extra GEMINI_*KEY* secrets before returning error only when all fail', async () => {
  const { resetKeyRotationForTests } = await import('../lib/geminiKeys.js');
  resetKeyRotationForTests();

  const env = {
    GEMINI_KEY: 'key-unnumbered',
    GEMINI_KEY_2: 'key-2',
    GEMINI_BACKUP_KEY: 'key-backup'
  };

  const seenKeys = [];
  const req = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'اختبار فشل كل المفاتيح' }]
    })
  });

  const res = await onRequestPost({
    request: req,
    env,
    generateFn: async ({ apiKey }) => {
      seenKeys.push(apiKey);
      const err = new Error('Resource has been exhausted');
      err.status = 429;
      throw err;
    }
  });

  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.errorCode, 'GLOBAL_QUOTA_EXHAUSTED');
  assert.equal(body.error.includes('24 ساعة'), true);
  assert.equal(seenKeys.includes('key-unnumbered'), true);
  assert.equal(seenKeys.includes('key-2'), true);
  assert.equal(seenKeys.includes('key-backup'), true);
  assert.equal(seenKeys.length, 3);
});

test('rotates silently without warning when key #1 returns 401 API key not valid (ACCESS_TOKEN_TYPE_UNSUPPORTED)', async () => {
  const { resetKeyRotationForTests } = await import('../lib/geminiKeys.js');
  resetKeyRotationForTests();

  const env = {
    GEMINI_KEY_1: 'AIzaSyBadKey123456789012345678901234',
    GEMINI_KEY_2: 'AIzaSyGoodKey12345678901234567890123'
  };

  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'مرحبا' }]
      })
    });

    const res = await onRequestPost({
      request: req,
      env,
      generateFn: async ({ apiKey }) => {
        if (apiKey === env.GEMINI_KEY_1) {
          const err = new Error('{"error":{"code":401,"message":"API key not valid.","details":[{"reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED"}]}}');
          err.status = 401;
          throw err;
        }
        return { text: 'تم الرد من المفتاح الثاني بنجاح' };
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.reply, 'تم الرد من المفتاح الثاني بنجاح');
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = origWarn;
  }
});

test('forwards exact user message to gemini-4-hydrogen and extracts non-thought reply parts when response.text is omitted', async () => {
  let capturedContents = null;
  const req = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'شلونك' }]
    })
  });

  const res = await onRequestPost({
    request: req,
    env: { GEMINI_KEY_1: 'test-key-1' },
    generateFn: async ({ contents, model }) => {
      capturedContents = { contents, model };
      return {
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'تفكير داخلي...' },
                { text: 'أهلاً بك! أنا بخير والحمد لله، كيف يمكنني مساعدتك اليوم؟' }
              ]
            }
          }
        ]
      };
    }
  });

  assert.equal(res.status, 200);
  assert.equal(capturedContents.model, 'gemini-4-hydrogen');
  assert.deepEqual(capturedContents.contents, [
    { role: 'user', parts: [{ text: 'شلونك' }] }
  ]);
  const body = await res.json();
  assert.equal(body.reply, 'أهلاً بك! أنا بخير والحمد لله، كيف يمكنني مساعدتك اليوم؟');
  assert.equal(body.modelName, 'Plus AI');
});

test('never stops early when previous keys were in 429 cooldown; tries every remaining key in env before failing', async () => {
  const { markGeminiKeyCooldown, resetKeyRotationForTests } = await import('../lib/geminiKeys.js');
  resetKeyRotationForTests();

  const env = {};
  for (let i = 1; i <= 13; i += 1) {
    env[`GEMINI_KEY_${i}`] = `key-${i}`;
  }
  for (let i = 1; i <= 12; i += 1) {
    markGeminiKeyCooldown(`key-${i}`, { status: 429 }, 'gemini-4-hydrogen');
  }

  const triedKeys = [];
  const req = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'مرحبا' }]
    })
  });

  const res = await onRequestPost({
    request: req,
    env,
    generateFn: async ({ apiKey }) => {
      triedKeys.push(apiKey);
      if (apiKey !== 'key-5') {
        const err = new Error('Resource has been exhausted (limit: 20)');
        err.status = 429;
        throw err;
      }
      return { text: 'نجح الرد عبر المفتاح 5 بعد تجربة المفاتيح المتبقية' };
    }
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reply, 'نجح الرد عبر المفتاح 5 بعد تجربة المفاتيح المتبقية');
  assert.equal(triedKeys[0], 'key-13');
  assert.equal(triedKeys.includes('key-5'), true);
});

test('POST /api/chat returns accurate quotaMeta on success, rotation 429, and pre-model validation errors', async () => {
  const { resetKeyRotationForTests } = await import('../lib/geminiKeys.js');
  resetKeyRotationForTests();

  const env = {};
  for (let i = 1; i <= 10; i += 1) {
    env[`GEMINI_KEY_${i}`] = `key-${i}`;
  }

  // Pre-model 400 validation error does not mark reachedModel
  const invalidReq = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [] })
  });
  const invalidRes = await onRequestPost({ request: invalidReq, env });
  assert.equal(invalidRes.status, 400);
  const invalidBody = await invalidRes.json();
  assert.equal(invalidBody.quotaMeta, undefined);

  // Real call where key-1 returns 429 and key-2 succeeds
  const validReq = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'مرحبا' }] })
  });
  const validRes = await onRequestPost({
    request: validReq,
    env,
    generateFn: async ({ apiKey }) => {
      if (apiKey === 'key-1') {
        const err = new Error('Resource has been exhausted (429)');
        err.status = 429;
        throw err;
      }
      return { text: 'أهلاً بك!' };
    }
  });
  assert.equal(validRes.status, 200);
  const validBody = await validRes.json();
  assert.equal(validBody.quotaMeta.validKeyCount, 10);
  assert.equal(validBody.quotaMeta.totalCapacity, 200);
  assert.equal(validBody.quotaMeta.quota429ThisRequest, 1);
  assert.equal(validBody.quotaMeta.exhaustedKeyCount, 1);
  assert.equal(validBody.quotaMeta.reachedModel, true);
  assert.equal(validBody.quotaMeta.succeeded, true);
});

