import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterChatsByTitle,
  mergeStoredChats,
  normalizeSettings,
  stripHeavyAttachmentsForLocalStorage
} from './chatStorage.js';

test('normalizes legacy settings to new model tiers', () => {
  const migrated = normalizeSettings({
    lang: 'ar',
    darkMode: true,
    selectedModel: 'deepseek-v4-pro'
  });
  assert.equal(migrated.lang, 'ar');
  assert.equal(migrated.darkMode, true);
  assert.equal(migrated.selectedModel, 'plus-max');
});

test('merges IndexedDB and localStorage chats without losing messages or offline renames', () => {
  const idbChats = [
    {
      id: 'chat-1',
      title: 'أول سؤال',
      createdAt: 100,
      updatedAt: 200,
      messages: [
        { id: 'm1', role: 'user', content: 'مرحبا' },
        { id: 'm2', role: 'assistant', content: 'أهلاً بك!' }
      ]
    }
  ];
  const lsChats = [
    {
      id: 'chat-1',
      title: 'اسم محدث',
      createdAt: 100,
      updatedAt: 200,
      messages: [
        { id: 'm1', role: 'user', content: 'مرحبا' },
        { id: 'm2', role: 'assistant', content: 'أهلاً بك!' }
      ]
    },
    {
      id: 'chat-2',
      title: 'محادثة قديمة',
      createdAt: 50,
      updatedAt: 150,
      messages: [{ id: 'm3', role: 'user', content: 'اختبار' }]
    }
  ];

  const merged = mergeStoredChats(idbChats, lsChats);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'chat-1');
  assert.equal(merged[0].title, 'اسم محدث');
  assert.equal(merged[0].messages.length, 2);
  assert.equal(merged[1].id, 'chat-2');
});

test('strips base64 attachment payloads for compact localStorage fallback', () => {
  const compacted = stripHeavyAttachmentsForLocalStorage([
    {
      id: 'chat-1',
      title: 'صور',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'حلل الصورة',
          attachments: [{ name: 'photo.png', mimeType: 'image/png', data: 'data:image/png;base64,AAA' }]
        }
      ]
    }
  ]);

  assert.equal(compacted[0].messages[0].attachments[0].name, 'photo.png');
  assert.equal(compacted[0].messages[0].attachments[0].data, undefined);
});

test('filters saved chats by title with Arabic and case-insensitive normalization', () => {
  const chats = [
    { id: '1', title: 'أفكار مشروع ذكاء اصطناعي' },
    { id: '2', title: 'خطة السفر إلى الرياض' },
    { id: '3', title: 'React Performance Tips' }
  ];

  assert.equal(filterChatsByTitle(chats, '').length, 3);
  assert.equal(filterChatsByTitle(chats, '   ').length, 3);
  assert.deepEqual(
    filterChatsByTitle(chats, 'افكار').map((c) => c.id),
    ['1']
  );
  assert.deepEqual(
    filterChatsByTitle(chats, 'الرياض').map((c) => c.id),
    ['2']
  );
  assert.deepEqual(
    filterChatsByTitle(chats, 'react').map((c) => c.id),
    ['3']
  );
  assert.deepEqual(filterChatsByTitle(chats, 'غير موجود'), []);
});
