import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSharePayload, resolveShareUrl, shareOrCopyApp } from './shareApp.js';

test('resolveShareUrl normalizes http/https origin and falls back cleanly', () => {
  assert.equal(
    resolveShareUrl({ origin: 'https://plus-ai.example.com', href: 'https://plus-ai.example.com/?foo=1' }),
    'https://plus-ai.example.com/'
  );
  assert.equal(resolveShareUrl({ origin: 'null', href: '' }), '');
});

test('buildSharePayload composes attractive invite copy and url for WhatsApp/Telegram sharing', () => {
  const payload = buildSharePayload(
    {
      shareAppTitle: 'Plus AI',
      shareAppInviteText: 'جرّب تطبيق Plus AI مجاناً!'
    },
    { origin: 'https://plus-ai.example.com' }
  );

  assert.equal(payload.title, 'Plus AI');
  assert.equal(payload.text, 'جرّب تطبيق Plus AI مجاناً!');
  assert.equal(payload.url, 'https://plus-ai.example.com/');
  assert.equal(payload.clipboardText, 'جرّب تطبيق Plus AI مجاناً!\nhttps://plus-ai.example.com/');
});

test('shareOrCopyApp uses Web Share API when available and succeeds', async () => {
  let receivedData = null;
  const result = await shareOrCopyApp({
    payload: {
      title: 'Plus AI',
      text: 'Invite message',
      url: 'https://plus-ai.example.com/',
      clipboardText: 'Invite message\nhttps://plus-ai.example.com/'
    },
    navigatorObj: {
      share: async (data) => {
        receivedData = data;
      }
    },
    documentObj: null
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'web-share');
  assert.equal(result.aborted, false);
  assert.deepEqual(receivedData, {
    title: 'Plus AI',
    text: 'Invite message',
    url: 'https://plus-ai.example.com/'
  });
});

test('shareOrCopyApp handles Web Share user cancellation gracefully without copying or failing loudly', async () => {
  let clipboardCalled = false;
  const result = await shareOrCopyApp({
    payload: {
      title: 'Plus AI',
      text: 'Invite',
      url: 'https://plus-ai.example.com/',
      clipboardText: 'Invite\nhttps://plus-ai.example.com/'
    },
    navigatorObj: {
      share: async () => {
        const err = new Error('User cancelled');
        err.name = 'AbortError';
        throw err;
      },
      clipboard: {
        writeText: async () => {
          clipboardCalled = true;
        }
      }
    },
    documentObj: null
  });

  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.equal(clipboardCalled, false);
});

test('shareOrCopyApp falls back to clipboard copy when Web Share throws non-abort error', async () => {
  let copiedText = '';
  const result = await shareOrCopyApp({
    payload: {
      title: 'Plus AI',
      text: 'جرّب Plus AI الآن',
      url: 'https://plus-ai.example.com/',
      clipboardText: 'جرّب Plus AI الآن\nhttps://plus-ai.example.com/'
    },
    navigatorObj: {
      share: async () => {
        throw new Error('NotAllowedError');
      },
      clipboard: {
        writeText: async (text) => {
          copiedText = text;
        }
      }
    },
    documentObj: null
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'clipboard');
  assert.equal(copiedText, 'جرّب Plus AI الآن\nhttps://plus-ai.example.com/');
});
