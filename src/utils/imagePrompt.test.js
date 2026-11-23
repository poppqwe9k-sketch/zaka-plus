import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPollinationsImageUrl,
  generateImageViaApi,
  isImageGenerationRequest
} from './imagePrompt.js';

test('detects image creation requests without matching regular chat questions about images', () => {
  assert.equal(isImageGenerationRequest('صمم لي صورة 10 أشخاص'), true);
  assert.equal(isImageGenerationRequest('ارسم لي قطة'), true);
  assert.equal(isImageGenerationRequest('generate an image of a forest'), true);
  assert.equal(isImageGenerationRequest('مرحبا بعد الصورة'), false);
  assert.equal(isImageGenerationRequest('ما هو محتوى هذه الصورة؟'), false);
});

test('calls /api/image with user prompt and returns Pollinations imageUrl, englishPrompt, and seed', async () => {
  let calledUrl = '';
  const fakeFetch = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        imageUrl: 'https://image.pollinations.ai/prompt/Ten%20people?width=768&height=768&model=flux&nologo=true&seed=4242',
        englishPrompt: 'Ten people',
        seed: 4242,
        model: 'flux'
      })
    };
  };

  const result = await generateImageViaApi('صمم لي صورة 10 أشخاص', fakeFetch);
  assert.equal(calledUrl, '/api/image');
  assert.equal(result.englishPrompt, 'Ten people');
  assert.equal(result.seed, 4242);
  assert.ok(result.imageUrl.includes('width=768&height=768&model=flux&nologo=true&seed=4242'));
});

test('buildPollinationsImageUrl encodes prompt and embeds random seed', () => {
  const url = buildPollinationsUrlCheck();
  assert.ok(url.includes('width=768&height=768&model=flux&nologo=true&seed=777'));
});

function buildPollinationsUrlCheck() {
  return buildPollinationsImageUrl('group of 10 people', { seed: 777 });
}

test('falls back directly to Pollinations URL if /api/image request fails', async () => {
  const result = await generateImageViaApi('صمم صورة غروب', async () => {
    throw new Error('Network unavailable');
  });
  assert.ok(result.imageUrl.startsWith('https://image.pollinations.ai/prompt/'));
  assert.ok(result.imageUrl.includes('width=768&height=768&model=flux&nologo=true&seed='));
});
