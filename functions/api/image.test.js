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
