import { DEFAULT_MODEL_TIER, normalizeModelTier } from '../shared/modelTiers.js';
import { isSupportedLanguage } from '../i18n/translations.js';

export const LEGACY_STORAGE_KEY = 'zaka-plus-chat-v5';
export const STORAGE_KEY = 'zaka-plus-chat-v6';
export const LEGACY_SETTINGS_STORAGE_KEY = 'plus-ai-settings-v1';
export const SETTINGS_STORAGE_KEY = 'plus-ai-settings-v2';
export const GUEST_SCOPE_KEY = 'guest';
export const DB_NAME = 'zaka-plus-offline-db';
export const DB_VERSION = 2;

const SCOPED_CHATS_STORE = 'scopedChats';
const SCOPED_META_STORE = 'scopedMeta';
const OWNER_INDEX = 'byOwner';
const LEGACY_CHATS_STORE = 'chats';
const LEGACY_META_STORE = 'meta';
const MAX_FIRESTORE_MESSAGES = 300;

export function getUserChatScopeKey(uid = '') {
  if (typeof uid === 'string' && uid.trim()) {
    return `user:${uid.trim()}`;
  }
  return GUEST_SCOPE_KEY;
}

export function getScopedStorageKey(scopeKey = GUEST_SCOPE_KEY) {
  const normalizedScope = typeof scopeKey === 'string' && scopeKey.trim()
    ? scopeKey.trim()
    : GUEST_SCOPE_KEY;
  return `${STORAGE_KEY}:${normalizedScope}`;
}

export function shouldPersistChatsForScope(activeScopeKey, loadedScopeKey) {
  return Boolean(activeScopeKey && loadedScopeKey && activeScopeKey === loadedScopeKey);
}

export function normalizeSearchText(value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

export function filterChatsByTitle(chats = [], query = '') {
  if (!Array.isArray(chats)) return [];
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return chats;
  return chats.filter((chat) => normalizeSearchText(chat?.title || '').includes(normalizedQuery));
}

export function getDefaultSettings(lang = 'ar') {
  return {
    lang: isSupportedLanguage(lang) ? lang : 'ar',
    darkMode: false,
    deepThinking: false,
    selectedModel: DEFAULT_MODEL_TIER,
    systemInstruction: ''
  };
}

export function normalizeSettings(rawSettings = {}) {
  const defaults = getDefaultSettings(rawSettings?.lang);
  return {
    lang: isSupportedLanguage(rawSettings?.lang) ? rawSettings.lang : defaults.lang,
    darkMode: Boolean(rawSettings?.darkMode),
    deepThinking: Boolean(rawSettings?.deepThinking),
    selectedModel: normalizeModelTier(rawSettings?.selectedModel),
    systemInstruction: typeof rawSettings?.systemInstruction === 'string'
      ? rawSettings.systemInstruction
      : ''
  };
}

export function normalizeChatRecord(chat) {
  if (!chat || typeof chat !== 'object' || typeof chat.id !== 'string') return null;
  const now = Date.now();
  const messages = Array.isArray(chat.messages)
    ? chat.messages
        .filter((m) => m && typeof m.id === 'string' && typeof m.role === 'string')
        .map((m) => (
          m.type === 'image' && m.imageLoading && !m.imageUrl
            ? { ...m, imageLoading: false, imageError: true }
            : m
        ))
    : [];
  const createdAt = typeof chat.createdAt === 'number'
    ? chat.createdAt
    : (typeof chat.createdAtMs === 'number' ? chat.createdAtMs : now);
  const updatedAt = typeof chat.updatedAt === 'number'
    ? chat.updatedAt
    : (typeof chat.updatedAtMs === 'number' ? chat.updatedAtMs : now);

  return {
    id: chat.id,
    title: typeof chat.title === 'string' && chat.title.trim() ? chat.title.trim() : 'محادثة جديدة',
    messages,
    createdAt,
    updatedAt
  };
}

export function sortChatsByRecent(chats) {
  return [...chats]
    .map(normalizeChatRecord)
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function mergeAttachmentArrays(remoteMessages = [], localMessages = []) {
  const localById = new Map();
  for (const msg of localMessages) {
    if (msg && typeof msg.id === 'string') {
      localById.set(msg.id, msg);
    }
  }
  return remoteMessages.map((msg) => {
    const localMatch = localById.get(msg.id);
    if (!localMatch || !Array.isArray(msg.attachments) || !Array.isArray(localMatch.attachments)) {
      return msg;
    }
    const mergedAttachments = msg.attachments.map((att, idx) => {
      if (att?.data) return att;
      const localAtt = localMatch.attachments[idx];
      if (localAtt?.data && localAtt?.name === att?.name) {
        return { ...att, data: localAtt.data };
      }
      return att;
    });
    return { ...msg, attachments: mergedAttachments };
  });
}

export function mergeStoredChats(primaryChats = [], secondaryChats = []) {
  const map = new Map();
  for (const item of secondaryChats) {
    const normalized = normalizeChatRecord(item);
    if (normalized) map.set(normalized.id, normalized);
  }
  for (const item of primaryChats) {
    const normalized = normalizeChatRecord(item);
    if (!normalized) continue;
    const existing = map.get(normalized.id);
    if (!existing) {
      map.set(normalized.id, normalized);
      continue;
    }
    const usePrimary = normalized.messages.length >= existing.messages.length
      && (normalized.updatedAt >= existing.updatedAt || normalized.messages.length > existing.messages.length);
    const chosen = usePrimary ? normalized : existing;
    const other = usePrimary ? existing : normalized;
    const mergedTitle = existing.title !== normalized.title && normalized.messages.length === existing.messages.length
      ? existing.title
      : chosen.title;
    const mergedMessages = mergeAttachmentArrays(chosen.messages, other.messages);
    map.set(normalized.id, { ...chosen, title: mergedTitle, messages: mergedMessages });
  }
  return sortChatsByRecent(Array.from(map.values()));
}

export function stripHeavyAttachmentsForLocalStorage(chats) {
  return chats.map((chat) => ({
    ...chat,
    messages: (chat.messages || []).map((msg) => {
      if (!Array.isArray(msg.attachments) || msg.attachments.length === 0) return msg;
      return {
        ...msg,
        attachments: msg.attachments.map(({ name, mimeType }) => ({ name, mimeType }))
      };
    })
  }));
}

function sanitizeSourcesForFirestore(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const seen = new Set();
  const clean = [];
  for (const item of sources) {
    const rawUri = typeof item?.uri === 'string' ? item.uri.trim() : '';
    if (!rawUri) continue;
    try {
      const parsed = new URL(rawUri);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
      const uri = parsed.toString().slice(0, 1000);
      if (seen.has(uri)) continue;
      seen.add(uri);
      clean.push({
        title: (typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : parsed.hostname).slice(0, 180),
        uri
      });
      if (clean.length >= 8) break;
    } catch {
      continue;
    }
  }
  return clean.length > 0 ? clean : null;
}

function sanitizeMessageForFirestore(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string' || typeof msg.role !== 'string') {
    return null;
  }
  const role = msg.role === 'assistant' ? 'assistant' : 'user';
  const clean = {
    id: msg.id.slice(0, 128),
    role,
    content: typeof msg.content === 'string' ? msg.content.slice(0, 20000) : '',
    createdAt: Number.isFinite(Number(msg.createdAt)) ? Math.max(0, Math.floor(Number(msg.createdAt))) : Date.now()
  };

  if (msg.type === 'image') {
    clean.type = 'image';
    clean.prompt = typeof msg.prompt === 'string' ? msg.prompt.slice(0, 1000) : '';
    clean.englishPrompt = typeof msg.englishPrompt === 'string' ? msg.englishPrompt.slice(0, 1000) : '';
    clean.imageUrl = typeof msg.imageUrl === 'string' ? msg.imageUrl.slice(0, 2000) : '';
    clean.imageModel = typeof msg.imageModel === 'string' ? msg.imageModel.slice(0, 40) : 'flux';
    clean.imageSeed = Number.isFinite(Number(msg.imageSeed)) ? Math.floor(Number(msg.imageSeed)) : null;
    clean.imageLoading = false;
    clean.imageError = Boolean(msg.imageError);
    clean.imageErrorMessage = typeof msg.imageErrorMessage === 'string'
      ? msg.imageErrorMessage.slice(0, 400)
      : '';
  }

  if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
    clean.attachments = msg.attachments.slice(0, 8).map((att) => ({
      name: typeof att?.name === 'string' ? att.name.slice(0, 180) : 'file',
      mimeType: typeof att?.mimeType === 'string' ? att.mimeType.slice(0, 100) : 'application/octet-stream'
    }));
  }

  const safeSources = sanitizeSourcesForFirestore(msg.sources);
  if (safeSources) {
    clean.sources = safeSources;
  }

  return clean;
}

export function prepareChatForFirestore(chat, uid) {
  if (!chat || typeof chat !== 'object' || typeof chat.id !== 'string' || !uid || typeof uid !== 'string') {
    return null;
  }
  const safeId = chat.id.trim().replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
  const safeUid = uid.trim();
  if (!safeId || !safeUid) return null;

  const now = Date.now();
  const createdAtMs = Number.isFinite(Number(chat.createdAt))
    ? Math.max(0, Math.floor(Number(chat.createdAt)))
    : now;
  const updatedAtMs = Number.isFinite(Number(chat.updatedAt))
    ? Math.max(createdAtMs, Math.floor(Number(chat.updatedAt)))
    : now;
  const title = typeof chat.title === 'string' && chat.title.trim()
    ? chat.title.trim().slice(0, 120)
    : 'محادثة جديدة';
  const rawMessages = Array.isArray(chat.messages) ? chat.messages.slice(-MAX_FIRESTORE_MESSAGES) : [];
  const messages = rawMessages.map(sanitizeMessageForFirestore).filter(Boolean);

  return {
    id: safeId,
    ownerUid: safeUid,
    title,
    messages,
    createdAtMs,
    updatedAtMs
  };
}

export function readAppSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return normalizeSettings(JSON.parse(raw));
    }
    const v1Raw = localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (v1Raw) {
      const v1Parsed = JSON.parse(v1Raw);
      const migrated = normalizeSettings({
        ...v1Parsed,
        selectedModel: DEFAULT_MODEL_TIER
      });
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw);
      const migrated = normalizeSettings({
        ...legacyParsed?.settings,
        selectedModel: DEFAULT_MODEL_TIER
      });
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // Ignore storage read errors.
  }
  return getDefaultSettings();
}

export function writeAppSettings(settings) {
  const normalized = normalizeSettings(settings);
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore quota errors.
  }
  return normalized;
}

export function readLocalStorageState(scopeKey = GUEST_SCOPE_KEY) {
  const settings = readAppSettings();
  const storageKey = getScopedStorageKey(scopeKey);
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return { chats: [], activeChatId: null, settings, scopeKey };
    }
    const parsed = JSON.parse(raw);
    const chats = sortChatsByRecent(Array.isArray(parsed?.chats) ? parsed.chats : []);
    const activeChatId = parsed?.activeChatId && chats.some((c) => c.id === parsed.activeChatId)
      ? parsed.activeChatId
      : (chats[0]?.id || null);
    return { chats, activeChatId, settings, scopeKey };
  } catch {
    return { chats: [], activeChatId: null, settings, scopeKey };
  }
}

export function writeLocalStorageState({ chats, activeChatId, settings }, scopeKey = GUEST_SCOPE_KEY) {
  const normalizedSettings = writeAppSettings(settings);
  const storageKey = getScopedStorageKey(scopeKey);
  try {
    const payload = { chats, activeChatId, settings: normalizedSettings };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    try {
      const compactChats = stripHeavyAttachmentsForLocalStorage(chats);
      localStorage.setItem(
        storageKey,
        JSON.stringify({ chats: compactChats, activeChatId, settings: normalizedSettings })
      );
    } catch {
      // Ignore quota errors when localStorage is full; IndexedDB retains full history.
    }
  }
}

function openChatDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        // Drop legacy unscoped v1 stores so old conversations never bleed across accounts.
        if (db.objectStoreNames.contains(LEGACY_CHATS_STORE)) {
          db.deleteObjectStore(LEGACY_CHATS_STORE);
        }
        if (db.objectStoreNames.contains(LEGACY_META_STORE)) {
          db.deleteObjectStore(LEGACY_META_STORE);
        }
        if (!db.objectStoreNames.contains(SCOPED_CHATS_STORE)) {
          const store = db.createObjectStore(SCOPED_CHATS_STORE, { keyPath: 'storageKey' });
          store.createIndex(OWNER_INDEX, 'ownerKey', { unique: false });
        }
        if (!db.objectStoreNames.contains(SCOPED_META_STORE)) {
          db.createObjectStore(SCOPED_META_STORE, { keyPath: 'ownerKey' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function deleteScopedIndexedDbChats(chatsStore, ownerKey) {
  return new Promise((resolve) => {
    try {
      const index = chatsStore.index(OWNER_INDEX);
      const cursorReq = index.openCursor(IDBKeyRange.only(ownerKey));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorReq.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadOfflineState(scopeKey = GUEST_SCOPE_KEY) {
  const localState = readLocalStorageState(scopeKey);
  const db = await openChatDatabase();
  if (!db) return localState;

  try {
    const tx = db.transaction([SCOPED_CHATS_STORE, SCOPED_META_STORE], 'readonly');
    const chatsIndex = tx.objectStore(SCOPED_CHATS_STORE).index(OWNER_INDEX);
    const chatsReq = chatsIndex.getAll(scopeKey);
    const metaReq = tx.objectStore(SCOPED_META_STORE).get(scopeKey);

    const [idbRawChats, idbMeta] = await Promise.all([
      new Promise((resolve) => {
        chatsReq.onsuccess = () => resolve(Array.isArray(chatsReq.result) ? chatsReq.result : []);
        chatsReq.onerror = () => resolve([]);
      }),
      new Promise((resolve) => {
        metaReq.onsuccess = () => resolve(metaReq.result || null);
        metaReq.onerror = () => resolve(null);
      })
    ]);

    const idbChats = idbRawChats
      .filter((row) => row?.ownerKey === scopeKey)
      .map((row) => normalizeChatRecord(row))
      .filter(Boolean);

    const mergedChats = mergeStoredChats(idbChats, localState.chats);
    const candidateActiveId = localState.activeChatId || idbMeta?.activeChatId;
    const activeChatId = candidateActiveId && mergedChats.some((c) => c.id === candidateActiveId)
      ? candidateActiveId
      : (mergedChats[0]?.id || null);

    return {
      chats: mergedChats,
      activeChatId,
      settings: localState.settings,
      scopeKey
    };
  } catch {
    return localState;
  } finally {
    db.close();
  }
}

export async function saveOfflineState({ chats, activeChatId, settings }, scopeKey = GUEST_SCOPE_KEY) {
  const normalizedSettings = normalizeSettings(settings);
  const normalizedChats = sortChatsByRecent(chats);
  writeLocalStorageState(
    {
      chats: normalizedChats,
      activeChatId,
      settings: normalizedSettings
    },
    scopeKey
  );

  const db = await openChatDatabase();
  if (!db) return;

  try {
    const tx = db.transaction([SCOPED_CHATS_STORE, SCOPED_META_STORE], 'readwrite');
    const chatsStore = tx.objectStore(SCOPED_CHATS_STORE);
    const metaStore = tx.objectStore(SCOPED_META_STORE);

    await deleteScopedIndexedDbChats(chatsStore, scopeKey);

    for (const chat of normalizedChats) {
      chatsStore.put({
        ...chat,
        ownerKey: scopeKey,
        storageKey: `${scopeKey}::${chat.id}`
      });
    }
    metaStore.put({
      ownerKey: scopeKey,
      activeChatId,
      updatedAt: Date.now()
    });

    await new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Fallback already persisted to localStorage.
  } finally {
    db.close();
  }
}

export async function clearOfflineChats(settings, scopeKey = GUEST_SCOPE_KEY) {
  const normalizedSettings = normalizeSettings(settings);
  writeLocalStorageState(
    {
      chats: [],
      activeChatId: null,
      settings: normalizedSettings
    },
    scopeKey
  );

  const db = await openChatDatabase();
  if (!db) return;

  try {
    const tx = db.transaction([SCOPED_CHATS_STORE, SCOPED_META_STORE], 'readwrite');
    const chatsStore = tx.objectStore(SCOPED_CHATS_STORE);
    await deleteScopedIndexedDbChats(chatsStore, scopeKey);
    tx.objectStore(SCOPED_META_STORE).put({
      ownerKey: scopeKey,
      activeChatId: null,
      updatedAt: Date.now()
    });
    await new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore IDB clear errors.
  } finally {
    db.close();
  }
}
