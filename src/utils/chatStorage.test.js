import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUEST_SCOPE_KEY,
  filterChatsByTitle,
  getUserChatScopeKey,
  mergeStoredChats,
  normalizeSettings,
  prepareChatForFirestore,
  readLocalStorageState,
  shouldPersistChatsForScope,
  stripHeavyAttachmentsForLocalStorage,
  writeLocalStorageState
} from './chatStorage.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

test('normalizes legacy settings to default بلس (plus-fast) while preserving plus-max and dark mode default', () => {
  const defaults = normalizeSettings({});
  assert.equal(defaults.darkMode, true);
  assert.equal(normalizeSettings({ darkMode: false }).darkMode, false);

  const migrated = normalizeSettings({
    lang: 'ar',
    darkMode: true,
    selectedModel: 'deepseek-v4-pro'
  });
  assert.equal(migrated.lang, 'ar');
  assert.equal(migrated.darkMode, true);
  assert.equal(migrated.selectedModel, 'plus-fast');
  assert.equal(normalizeSettings({ selectedModel: 'plus-max' }).selectedModel, 'plus-max');
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

test('isolates chat storage completely between distinct user UIDs and guest scope', () => {
  const prevStorage = globalThis.localStorage;
  globalThis.localStorage = createMemoryStorage();
  try {
    const scopeA = getUserChatScopeKey('uid-user-a');
    const scopeB = getUserChatScopeKey('uid-user-b');
    const guestScope = getUserChatScopeKey('');

    assert.equal(scopeA, 'user:uid-user-a');
    assert.equal(scopeB, 'user:uid-user-b');
    assert.equal(guestScope, GUEST_SCOPE_KEY);

    writeLocalStorageState(
      {
        chats: [{ id: 'cA', title: 'محادثة المستخدم أ', createdAt: 10, updatedAt: 20, messages: [{ id: 'm1', role: 'user', content: 'سري' }] }],
        activeChatId: 'cA',
        settings: { lang: 'ar', darkMode: true }
      },
      scopeA
    );

    const stateA = readLocalStorageState(scopeA);
    const stateB = readLocalStorageState(scopeB);
    const stateGuest = readLocalStorageState(guestScope);

    assert.equal(stateA.chats.length, 1);
    assert.equal(stateA.chats[0].title, 'محادثة المستخدم أ');
    assert.equal(stateB.chats.length, 0);
    assert.equal(stateB.activeChatId, null);
    assert.equal(stateGuest.chats.length, 0);
    assert.equal(stateGuest.activeChatId, null);
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('shouldPersistChatsForScope prevents writing old chats into a newly switched account', () => {
  assert.equal(shouldPersistChatsForScope('user:uid-a', 'user:uid-a'), true);
  assert.equal(shouldPersistChatsForScope('user:uid-b', 'user:uid-a'), false);
  assert.equal(shouldPersistChatsForScope('guest', 'user:uid-a'), false);
  assert.equal(shouldPersistChatsForScope('user:uid-a', null), false);
});

test('prepareChatForFirestore produces rule-compliant UserChat payload without base64 blobs or undefined fields', () => {
  const prepared = prepareChatForFirestore(
    {
      id: 'chat-123',
      title: '  تحليل ملف مهم  ',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'مرحبا',
          createdAt: 1001,
          attachments: [{ name: 'doc.pdf', mimeType: 'application/pdf', data: 'data:application/pdf;base64,HUGE' }]
        },
        {
          id: 'm2',
          role: 'assistant',
          type: 'image',
          prompt: 'قمر',
          englishPrompt: 'moon',
          imageUrl: 'https://example.com/moon.jpg',
          imageLoading: true,
          imageError: false,
          sources: [
            { title: 'Google News', uri: 'https://news.google.com/article' },
            { title: 'Bad Link', uri: 'javascript:alert(1)' }
          ],
          createdAt: 1500
        }
      ]
    },
    'uid-owner-1'
  );

  assert.equal(prepared.id, 'chat-123');
  assert.equal(prepared.ownerUid, 'uid-owner-1');
  assert.equal(prepared.title, 'تحليل ملف مهم');
  assert.equal(prepared.createdAtMs, 1000);
  assert.equal(prepared.updatedAtMs, 2000);
  assert.equal(prepared.messages.length, 2);
  assert.equal(prepared.messages[0].attachments[0].name, 'doc.pdf');
  assert.equal(prepared.messages[0].attachments[0].data, undefined);
  assert.equal(prepared.messages[1].imageLoading, false);
  assert.equal(prepared.messages[1].sources.length, 1);
  assert.equal(prepared.messages[1].sources[0].uri, 'https://news.google.com/article');
  assert.equal('undefinedKey' in prepared.messages[0], false);
  assert.equal(normalizeSettings({ selectedModel: 'plus-fast' }).selectedModel, 'plus-fast');
  assert.equal(normalizeSettings({ selectedModel: 'plus-max' }).selectedModel, 'plus-max');
});
