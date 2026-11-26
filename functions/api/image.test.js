import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MYMEMORY_TRANSLATE_URL,
  POLLINATIONS_IMAGE_BASE,
  generatePollinationsImage,
  onRequestPost,
  translatePromptWithMyMemory
} from './image.js';

test('translates Arabic prompt via MyMemory API (ar|en) and appends wide angle quality suffix', async () => {
  let calledUrl = '';
  const fakeFetch = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        responseData: {
          translatedText: 'Design an image of 10 people for me.'
        }
      })
    };
  };

  const englishPrompt = await translatePromptWithMyMemory('صمم لي صورة 10 أشخاص', fakeFetch);
  assert.ok(calledUrl.startsWith(`${MYMEMORY_TRANSLATE_URL}?q=`));
  assert.ok(calledUrl.includes('&langpair=ar|en'));
  assert.equal(englishPrompt, 'Design an image of 10 people for me, wide angle shot, high quality, detailed');
});

test('POST /api/image translates via MyMemory and returns Pollinations Flux URL with random seed', async () => {
  const req = new Request('http://localhost:3000/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'صمم لي صورة 10 أشخاص' })
  });

  const res = await onRequestPost({
    request: req,
    seed: 65432,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        responseData: { translatedText: 'A group of 10 people' }
      })
    })
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.englishPrompt, 'A group of 10 people, wide angle shot, high quality, detailed');
  assert.equal(body.seed, 65432);
  assert.ok(body.imageUrl.startsWith(`${POLLINATIONS_IMAGE_BASE}/`));
  assert.ok(body.imageUrl.includes('width=768&height=768&model=flux&nologo=true&seed=65432'));
});

test('keeps non-Arabic prompts intact with quality suffix without needing MyMemory call', async () => {
  let fetchCalled = false;
  const result = await generatePollinationsImage({
    prompt: 'A futuristic city at sunset',
    seed: 1111,
    fetchImpl: async () => {
      fetchCalled = true;
      return { ok: false, status: 500 };
    }
  });
  assert.equal(fetchCalled, false);
  assert.equal(result.englishPrompt, 'A futuristic city at sunset, wide angle shot, high quality, detailed');
});

test('POST /api/image rotates across GEMINI_KEY_1..GEMINI_KEY_13 for prompt translation and falls back to MyMemory if needed', async () => {
  const { resetKeyRotationForTests } = await import('../lib/geminiKeys.js');
  resetKeyRotationForTests();

  const env = {};
  for (let i = 1; i <= 13; i += 1) {
    env[`GEMINI_KEY_${i}`] = `img-key-${i}`;
  }

  const usedKeys = [];
  const req1 = new Request('http://localhost:3000/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'صمم لي صورة 10 أشخاص' })
  });

  const res1 = await onRequestPost({
    request: req1,
    env,
    seed: 1234,
    generateFn: async ({ apiKey }) => {
      usedKeys.push(apiKey);
      if (apiKey === 'img-key-1') {
        const err = new Error('429 quota');
        err.status = 429;
        throw err;
      }
      return { text: 'A detailed wide photograph of 10 diverse people standing together' };
    }
  });

  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.deepEqual(usedKeys, ['img-key-1', 'img-key-2']);
  assert.equal(body1.promptModel, 'gemini-4-hydrogen');
  assert.equal(
    body1.promptChars,
    'صمم لي صورة 10 أشخاص'.length + 'A detailed wide photograph of 10 diverse people standing together'.length
  );
  assert.equal(
    body1.englishPrompt,
    'A detailed wide photograph of 10 diverse people standing together, wide angle shot, high quality, detailed'
  );

  // Next request continues rotation cleanly from next healthy key
  const req2 = new Request('http://localhost:3000/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'قمر مكتمل' })
  });

  let secondCallKey = '';
  const res2 = await onRequestPost({
    request: req2,
    env,
    seed: 5678,
    generateFn: async ({ apiKey }) => {
      secondCallKey = apiKey;
      return { text: 'A glowing full moon over calm dark ocean' };
    }
  });

  assert.equal(res2.status, 200);
  assert.equal(secondCallKey, 'img-key-3');
});
