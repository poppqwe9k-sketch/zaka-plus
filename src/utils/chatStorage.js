import { DEFAULT_MODEL_TIER, normalizeModelTier } from '../shared/modelTiers.js';
import { isSupportedLanguage } from '../i18n/translations.js';

export const STORAGE_KEY = 'zaka-plus-chat-v5';
export const DB_NAME = 'zaka-plus-offline-db';
export const DB_VERSION = 1;
const CHATS_STORE = 'chats';
const META_STORE = 'meta';

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
  return {
    id: chat.id,
    title: typeof chat.title === 'string' && chat.title.trim() ? chat.title.trim() : 'محادثة جديدة',
    messages,
    createdAt: typeof chat.createdAt === 'number' ? chat.createdAt : now,
    updatedAt: typeof chat.updatedAt === 'number' ? chat.updatedAt : now
  };
}

export function sortChatsByRecent(chats) {
  return [...chats]
    .map(normalizeChatRecord)
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
    // Preserve title edits made in localStorage if secondary has a newer or distinct title when message counts match
    const mergedTitle = existing.title !== normalized.title && normalized.messages.length === existing.messages.length
      ? existing.title
      : chosen.title;
    map.set(normalized.id, { ...chosen, title: mergedTitle });
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

export function readLocalStorageState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { chats: [], activeChatId: null, settings: getDefaultSettings() };
    }
    const parsed = JSON.parse(raw);
    const chats = sortChatsByRecent(Array.isArray(parsed?.chats) ? parsed.chats : []);
    const settings = normalizeSettings(parsed?.settings);
    const activeChatId = parsed?.activeChatId && chats.some((c) => c.id === parsed.activeChatId)
      ? parsed.activeChatId
      : (chats[0]?.id || null);
    return { chats, activeChatId, settings };
  } catch {
    return { chats: [], activeChatId: null, settings: getDefaultSettings() };
  }
}

export function writeLocalStorageState({ chats, activeChatId, settings }) {
  try {
    const payload = { chats, activeChatId, settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    try {
      const compactChats = stripHeavyAttachmentsForLocalStorage(chats);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats: compactChats, activeChatId, settings }));
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
        if (!db.objectStoreNames.contains(CHATS_STORE)) {
          db.createObjectStore(CHATS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadOfflineState() {
  const localState = readLocalStorageState();
  const db = await openChatDatabase();
  if (!db) return localState;

  try {
    const tx = db.transaction([CHATS_STORE, META_STORE], 'readonly');
    const chatsReq = tx.objectStore(CHATS_STORE).getAll();
    const metaReq = tx.objectStore(META_STORE).get('appState');

    const [idbChats, idbMeta] = await Promise.all([
      new Promise((resolve) => {
        chatsReq.onsuccess = () => resolve(Array.isArray(chatsReq.result) ? chatsReq.result : []);
        chatsReq.onerror = () => resolve([]);
      }),
      new Promise((resolve) => {
        metaReq.onsuccess = () => resolve(metaReq.result?.value || null);
        metaReq.onerror = () => resolve(null);
      })
    ]);

    const mergedChats = mergeStoredChats(idbChats, localState.chats);
    const mergedSettings = normalizeSettings(
      localState.settings?.lang ? { ...(idbMeta?.settings || {}), ...localState.settings } : idbMeta?.settings
    );
    const candidateActiveId = localState.activeChatId || idbMeta?.activeChatId;
    const activeChatId = candidateActiveId && mergedChats.some((c) => c.id === candidateActiveId)
      ? candidateActiveId
      : (mergedChats[0]?.id || null);

    return {
      chats: mergedChats,
      activeChatId,
      settings: mergedSettings
    };
  } catch {
    return localState;
  } finally {
    db.close();
  }
}

export async function saveOfflineState({ chats, activeChatId, settings }) {
  const normalizedSettings = normalizeSettings(settings);
  const normalizedChats = sortChatsByRecent(chats);
  writeLocalStorageState({
    chats: normalizedChats,
    activeChatId,
    settings: normalizedSettings
  });

  const db = await openChatDatabase();
  if (!db) return;

  try {
    await new Promise((resolve) => {
      const tx = db.transaction([CHATS_STORE, META_STORE], 'readwrite');
      const chatsStore = tx.objectStore(CHATS_STORE);
      const metaStore = tx.objectStore(META_STORE);

      chatsStore.clear();
      for (const chat of normalizedChats) {
        chatsStore.put(chat);
      }
      metaStore.put({
        key: 'appState',
        value: {
          activeChatId,
          settings: normalizedSettings,
          updatedAt: Date.now()
        }
      });

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

export async function clearOfflineChats(settings) {
  const normalizedSettings = normalizeSettings(settings);
  writeLocalStorageState({
    chats: [],
    activeChatId: null,
    settings: normalizedSettings
  });

  const db = await openChatDatabase();
  if (!db) return;

  try {
    await new Promise((resolve) => {
      const tx = db.transaction([CHATS_STORE, META_STORE], 'readwrite');
      tx.objectStore(CHATS_STORE).clear();
      tx.objectStore(META_STORE).put({
        key: 'appState',
        value: { activeChatId: null, settings: normalizedSettings, updatedAt: Date.now() }
      });
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
