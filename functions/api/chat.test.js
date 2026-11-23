import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from './chat.js';

test('Plus Max automatically falls back from gemini-4-hydrogen to gemini-2.5-flash on 429 quota exceeded', async () => {
  const attempted = [];
  const req = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'مرحبا' }],
      selectedModel: 'plus-max'
    })
  });

  const res = await onRequestPost({
    request: req,
    env: { GEMINI_API_KEY: 'test-key' },
    generateFn: async ({ model, config }) => {
      attempted.push({ model, thinkingConfig: config.thinkingConfig });
      if (model === 'gemini-4-hydrogen') {
        const err = new Error('You exceeded your current quota (429)');
        err.status = 429;
        throw err;
      }
      return { text: 'أهلاً! تم الرد عبر النموذج البديل بنجاح.' };
    }
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reply, 'أهلاً! تم الرد عبر النموذج البديل بنجاح.');
  assert.equal(body.model, 'gemini-2.5-flash');
  assert.equal(body.requestedModel, 'gemini-4-hydrogen');
  assert.equal(body.usedFallback, true);
  assert.equal(attempted.length, 2);
  assert.equal(attempted[0].model, 'gemini-4-hydrogen');
  assert.ok('thinkingLevel' in attempted[0].thinkingConfig);
  assert.equal(attempted[1].model, 'gemini-2.5-flash');
  assert.equal(attempted[1].thinkingConfig.thinkingBudget, 8192);
});

test('Plus tier calls gemini-2.5-flash directly with thinkingBudget: 0', async () => {
  let captured = null;
  const req = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'اختبار سريع' }],
      selectedModel: 'plus'
    })
  });

  const res = await onRequestPost({
    request: req,
    env: { GEMINI_API_KEY: 'test-key' },
    generateFn: async ({ model, config }) => {
      captured = { model, config };
      return { text: 'رد سريع' };
    }
  });

  assert.equal(res.status, 200);
  assert.equal(captured.model, 'gemini-2.5-flash');
  assert.equal(captured.config.thinkingConfig.thinkingBudget, 0);
});
