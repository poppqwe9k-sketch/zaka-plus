import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatHistoryPayload } from './chatHistory.js';

test('filters out empty messages, failed image messages, and merges consecutive same-role turns', () => {
  const messages = [
    { role: 'user', content: 'صمم لي صورة 10 أشخاص' },
    { role: 'assistant', type: 'image', content: '', imageUrl: 'https://image.pollinations.ai/prompt/test', imageError: false },
    { role: 'user', content: '   ' },
    { role: 'assistant', type: 'image', content: 'خطأ في الصورة', imageError: true },
    { role: 'user', content: 'ما هي عاصمة مصر؟' }
  ];

  const payload = buildChatHistoryPayload(messages);
  assert.deepEqual(payload, [
    { role: 'user', content: 'صمم لي صورة 10 أشخاص\n\nما هي عاصمة مصر؟' }
  ]);
});

test('ensures filtered history never starts with an assistant message and respects maxMessages', () => {
  const messages = [
    { role: 'assistant', content: 'رد قديم' },
    { role: 'user', content: 'سؤال 1' },
    { role: 'assistant', content: 'جواب 1' },
    { role: 'user', content: 'سؤال 2' }
  ];

  const payload = buildChatHistoryPayload(messages, 3);
  assert.deepEqual(payload, [
    { role: 'user', content: 'سؤال 1' },
    { role: 'assistant', content: 'جواب 1' },
    { role: 'user', content: 'سؤال 2' }
  ]);
});
