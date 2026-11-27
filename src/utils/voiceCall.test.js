import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoiceSystemInstruction,
  extractAudioBase64Payload,
  formatCallDuration,
  prepareTextForSpeech
} from './voiceCall.js';

test('formatCallDuration formats elapsed seconds cleanly as MM:SS', () => {
  assert.equal(formatCallDuration(0), '00:00');
  assert.equal(formatCallDuration(-5), '00:00');
  assert.equal(formatCallDuration(9), '00:09');
  assert.equal(formatCallDuration(65), '01:05');
  assert.equal(formatCallDuration(600), '10:00');
});

test('prepareTextForSpeech strips markdown, code blocks, and URLs cleanly', () => {
  const input = '## مرحباً!\nهذا **مثال** مع `code` و [رابط](https://example.com) و ```js\nconst x = 1;\n```';
  const cleaned = prepareTextForSpeech(input);
  assert.equal(cleaned, 'مرحباً! هذا مثال مع code و رابط و');
});

test('buildVoiceSystemInstruction appends conversational voice rules for Arabic and English', () => {
  const arPrompt = buildVoiceSystemInstruction('تحدث بلطف', 'ar');
  assert.match(arPrompt, /تحدث بلطف/);
  assert.match(arPrompt, /مكالمة صوتية مباشرة/);

  const enPrompt = buildVoiceSystemInstruction('', 'en');
  assert.match(enPrompt, /live voice call/i);
  assert.match(enPrompt, /without markdown/i);
});

test('extractAudioBase64Payload parses valid data URLs with codecs and rejects invalid inputs', () => {
  const parsed = extractAudioBase64Payload('data:audio/webm;codecs=opus;base64,SGVsbG8=');
  assert.deepEqual(parsed, {
    mimeType: 'audio/webm',
    audioBase64: 'SGVsbG8='
  });
  assert.equal(extractAudioBase64Payload('data:image/png;base64,AAAA'), null);
  assert.equal(extractAudioBase64Payload('not-a-data-url'), null);
});
