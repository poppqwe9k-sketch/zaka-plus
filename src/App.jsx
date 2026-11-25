import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './chat-redesign.css';
import './chat-features.css';
import './settings.css';
import './image-generation.css';
import './speech-dictation.css';
import './credits-admob.css';
import './auth-admin.css';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase.js';
import { enableChatAutoScroll, scrollToBottom } from './chat-scroll.js';
import {
  FAST_MODEL_TIER,
  GEMINI_FALLBACK_LITE_MODEL_ID,
  GEMINI_HYDROGEN_MODEL_ID,
  MODEL_SELECTOR_OPTIONS,
  SUPER_MODEL_TIER,
  normalizeModelTier
} from './shared/modelTiers.js';
import AuthModal from './components/AuthModal.jsx';
import AdminPanelModal from './components/AdminPanelModal.jsx';
import {
  LANGUAGES,
  getLanguageMeta,
  getTranslation
} from './i18n/translations.js';
import {
  GUEST_SCOPE_KEY,
  clearOfflineChats,
  filterChatsByTitle,
  getUserChatScopeKey,
  loadOfflineState,
  mergeStoredChats,
  normalizeSettings,
  readAppSettings,
  shouldPersistChatsForScope,
  saveOfflineState,
  writeAppSettings
} from './utils/chatStorage.js';
import { buildChatHistoryPayload } from './utils/chatHistory.js';
import {
  buildPollinationsImageUrl,
  generateImageViaApi,
  isImageGenerationRequest
} from './utils/imagePrompt.js';
import {
  extractSpeechTranscript,
  getSpeechRecognitionConstructor,
  mapSpeechErrorToKey,
  mergeDictatedText,
  resolveSpeechLocale
} from './utils/speechDictation.js';
import {
  PLUS_QUOTA_PER_KEY,
  PLUS_QUOTA_STORAGE_KEY,
  QUOTA_STORAGE_KEY,
  applyMessageSendQuota,
  loadDailyQuotaState,
  reconcileQuotaState,
  saveDailyQuotaState
} from './utils/dailyQuota.js';
import {
  DAILY_FREE_CREDITS,
  consumeOneCredit,
  getLocalDateKey,
  getUserCreditsStorageKey,
  isCreditsCycleExpired,
  loadCreditsState,
  normalizeCreditsState,
  saveCreditsState,
  shouldDeductCreditForReply,
  shouldUseFallbackLiteModel
} from './utils/credits.js';
import {
  clampCredits,
  clampDailyLimit,
  isAdminEmailUnverified,
  isAdminUser,
  normalizePlan,
  sanitizeDisplayName
} from './utils/authAdmin.js';
import {
  adminUpdateUserSubscription,
  clearUserChatsInFirestore,
  consumeUserCreditInFirestore,
  deleteUserChatInFirestore,
  fetchAdminDashboardData,
  recordModelUsageInFirestore,
  renewExpiredCycleInFirestore,
  subscribeAdminDashboardData,
  subscribeUserChats,
  subscribeUserProfile,
  syncUserProfileOnSignIn,
  upsertUserChatInFirestore
} from './services/userAccountService.js';
import {
  calculateExchangeCharCount,
  getPacificCycleStartMs,
  getPacificDateKey
} from './utils/pacificTime.js';
import { buildSharePayload, shareOrCopyApp } from './utils/shareApp.js';

const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;

function isQuotaExhaustedResponse(status, data, messageText = '') {
  if (status === 429) return true;
  if (data?.errorCode === 'GLOBAL_QUOTA_EXHAUSTED') return true;
  const combined = `${data?.error || ''} ${data?.message || ''} ${messageText || ''}`;
  return /429|resource_exhausted|resource has been exhausted|quota exceeded|too many requests|limit:\s*20|global_quota_exhausted/i.test(combined);
}

function createId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}

function StopMicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
    </svg>
  );
}

function ModelsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" />
      <path d="M4 12l8 4.5 8-4.5" />
      <path d="M4 16.5L12 21l8-4.5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function DeepThinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" />
    </svg>
  );
}

function ImageCreateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 15l-4.5-4.5L7 20" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5" />
      <path d="M10 14L19 5" />
      <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function sanitizeClientSources(rawSources) {
  if (!Array.isArray(rawSources) || rawSources.length === 0) return [];
  const seen = new Set();
  const list = [];
  for (const item of rawSources) {
    const rawUri = typeof item?.uri === 'string' ? item.uri.trim() : '';
    if (!rawUri) continue;
    try {
      const parsed = new URL(rawUri);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
      const uri = parsed.toString();
      if (seen.has(uri)) continue;
      seen.add(uri);
      list.push({
        title: (typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : parsed.hostname).slice(0, 180),
        uri
      });
      if (list.length >= 8) break;
    } catch {
      continue;
    }
  }
  return list;
}

export default function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [settings, setSettings] = useState(() => normalizeSettings(readAppSettings()));
  const [loadedScopeKey, setLoadedScopeKey] = useState(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [renamingTitle, setRenamingTitle] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [credits, setCredits] = useState(() => loadCreditsState());
  const [creditsExhaustedHighlight, setCreditsExhaustedHighlight] = useState(false);
  const [globalCapacityExhausted, setGlobalCapacityExhausted] = useState(false);
  const [dailyQuota, setDailyQuota] = useState(() => {
    const saved = loadDailyQuotaState(undefined, QUOTA_STORAGE_KEY);
    return saved ? reconcileQuotaState(saved, {}) : null;
  });
  const [plusDailyQuota, setPlusDailyQuota] = useState(() => {
    const saved = loadDailyQuotaState(undefined, PLUS_QUOTA_STORAGE_KEY);
    return saved ? reconcileQuotaState(saved, { quotaPerKey: PLUS_QUOTA_PER_KEY }) : null;
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('login');
  const [authPromptMessage, setAuthPromptMessage] = useState('');
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminUsersList, setAdminUsersList] = useState([]);
  const [adminAnalytics, setAdminAnalytics] = useState({ totalVisits: 0, registeredUsersCount: 0 });
  const [adminQuotaAnalytics, setAdminQuotaAnalytics] = useState(() => ({
    cycleStartedAt: getPacificCycleStartMs(),
    ptDateKey: getPacificDateKey(),
    plusPlusUsed: 0,
    plusUsed: 0,
    plusPlusChars: 0,
    plusChars: 0
  }));
  const [shareStatus, setShareStatus] = useState(null);
  const shareTimerRef = useRef(null);

  const imageInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const composerRef = useRef(null);
  const messageInputRef = useRef(null);
  const renameInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceBaseTextRef = useRef('');
  const voiceFinalTextRef = useRef('');
  const voiceLatestTextRef = useRef('');
  const activeScopeRef = useRef(GUEST_SCOPE_KEY);
  const knownRemoteChatIdsRef = useRef(new Set());
  const deletedChatIdsRef = useRef(new Set());
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const isSpeechSupported = Boolean(
    getSpeechRecognitionConstructor(typeof window !== 'undefined' ? window : null)
  );

  const langMeta = getLanguageMeta(settings.lang);
  const t = getTranslation(langMeta.code);
  const activeModelTier = normalizeModelTier(settings.selectedModel);
  const activeModelOption = MODEL_SELECTOR_OPTIONS.find((opt) => opt.id === activeModelTier) || MODEL_SELECTOR_OPTIONS[0];
  const activeChat = chats.find((c) => c.id === activeChatId) || null;
  const filteredChats = useMemo(
    () => filterChatsByTitle(chats, historyQuery),
    [chats, historyQuery]
  );
  const messages = activeChat?.messages || [];

  const activeScopeKey = useMemo(
    () => getUserChatScopeKey(currentUser?.uid || ''),
    [currentUser?.uid]
  );
  activeScopeRef.current = activeScopeKey;

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setError('');
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = langMeta.code;
    document.documentElement.dir = langMeta.dir;
  }, [langMeta.code, langMeta.dir]);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add('sidebar-is-open');
    } else {
      document.body.classList.remove('sidebar-is-open');
    }
    return () => document.body.classList.remove('sidebar-is-open');
  }, [sidebarOpen]);

  useEffect(() => {
    writeAppSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!shouldPersistChatsForScope(activeScopeKey, loadedScopeKey)) return;
    saveOfflineState({ chats, activeChatId, settings }, activeScopeKey);
  }, [chats, activeChatId, settings, activeScopeKey, loadedScopeKey]);

  useEffect(() => {
    const storageKey = getUserCreditsStorageKey(currentUser?.uid || '');
    saveCreditsState(credits, storageKey);
  }, [credits, currentUser?.uid]);

  useEffect(() => {
    if (credits.remaining <= 0 && activeModelTier !== FAST_MODEL_TIER) {
      setSettings((prev) => normalizeSettings({ ...prev, selectedModel: FAST_MODEL_TIER }));
    }
  }, [credits.remaining, activeModelTier]);

  useEffect(() => {
    if (!renamingChatId) return;
    const inputEl = renameInputRef.current;
    if (!inputEl) return;
    inputEl.focus();
    try {
      const len = inputEl.value.length;
      inputEl.setSelectionRange(len, len);
    } catch {
      // Ignore selection errors on unsupported input types.
    }
  }, [renamingChatId]);

  const userIsAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);
  const userIsUnverifiedAdmin = useMemo(() => isAdminEmailUnverified(currentUser), [currentUser]);

  const syncChatToCloud = useCallback((uid, chatObj) => {
    if (!uid || !chatObj) return;
    const isKnownRemote = knownRemoteChatIdsRef.current.has(chatObj.id);
    upsertUserChatInFirestore(uid, chatObj, { isKnownRemote })
      .then(() => {
        knownRemoteChatIdsRef.current.add(chatObj.id);
      })
      .catch((err) => {
        console.error('Failed syncing chat to Firestore:', err);
      });
  }, []);

  useEffect(() => {
    let unsubProfile = null;
    let unsubChats = null;
    let cancelled = false;
    let previousUid = null;

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (unsubChats) {
        unsubChats();
        unsubChats = null;
      }

      if (cancelled) return;

      const nextUid = firebaseUser?.uid || null;
      const nextScopeKey = getUserChatScopeKey(nextUid || '');
      const switchedAccount = previousUid !== nextUid;
      previousUid = nextUid;
      activeScopeRef.current = nextScopeKey;

      // Immediately clear previous account's in-memory UI state before hydrating the new account.
      setLoadedScopeKey(null);
      setChats([]);
      setActiveChatId(null);
      if (switchedAccount) {
        setInput('');
        setAttachments([]);
        setHistoryQuery('');
        setError('');
        setIsSending(false);
        setCreditsExhaustedHighlight(false);
      }
      knownRemoteChatIdsRef.current = new Set();
      deletedChatIdsRef.current = new Set();

      setCurrentUser(firebaseUser || null);
      setAuthReady(true);

      if (!firebaseUser) {
        setUserProfile(null);
        setAdminModalOpen(false);
        setAdminUsersList([]);
        setCredits(loadCreditsState());
        const guestHydrated = await loadOfflineState(GUEST_SCOPE_KEY);
        if (cancelled || activeScopeRef.current !== GUEST_SCOPE_KEY) return;
        setChats(guestHydrated.chats);
        setActiveChatId(guestHydrated.activeChatId);
        setLoadedScopeKey(GUEST_SCOPE_KEY);
        return;
      }

      const cachedKey = getUserCreditsStorageKey(firebaseUser.uid);
      setCredits(loadCreditsState(getLocalDateKey(), Date.now(), DAILY_FREE_CREDITS, cachedKey));

      const userHydrated = await loadOfflineState(nextScopeKey);
      if (cancelled || activeScopeRef.current !== nextScopeKey) return;
      setChats(userHydrated.chats);
      setActiveChatId(userHydrated.activeChatId);
      setLoadedScopeKey(nextScopeKey);

      try {
        await syncUserProfileOnSignIn(firebaseUser);
      } catch (err) {
        console.error('Failed syncing user profile:', err);
      }

      if (cancelled || activeScopeRef.current !== nextScopeKey) return;

      unsubProfile = subscribeUserProfile(
        firebaseUser.uid,
        (profileData) => {
          if (cancelled || activeScopeRef.current !== nextScopeKey) return;
          setUserProfile(profileData);
          const nowMs = Date.now();
          const todayKey = getLocalDateKey(new Date(nowMs));
          const userDailyLimit = clampDailyLimit(profileData.dailyLimit);
          const synced = normalizeCreditsState(
            {
              remaining: clampCredits(profileData.remainingCredits, userDailyLimit),
              cycleStartedAt: Number(profileData.cycleStartedAt) || nowMs,
              lastResetDate: profileData.lastResetDate || todayKey,
              totalUsed: Number(profileData.totalUsed) || 0
            },
            todayKey,
            nowMs,
            userDailyLimit
          );
          setCredits(synced);
          saveCreditsState(synced, cachedKey);
        },
        (subErr) => {
          console.error('User profile subscription error:', subErr);
        }
      );

      unsubChats = subscribeUserChats(
        firebaseUser.uid,
        (remoteChats) => {
          if (cancelled || activeScopeRef.current !== nextScopeKey) return;
          for (const chat of remoteChats) {
            knownRemoteChatIdsRef.current.add(chat.id);
          }
          const filteredRemote = remoteChats.filter(
            (chat) => !deletedChatIdsRef.current.has(chat.id)
          );
          setChats((prev) => {
            const merged = mergeStoredChats(filteredRemote, prev);
            setActiveChatId((currentActive) => (
              currentActive && merged.some((c) => c.id === currentActive)
                ? currentActive
                : (merged[0]?.id || null)
            ));
            return merged;
          });
        },
        (chatsErr) => {
          console.error('User chats subscription error:', chatsErr);
        }
      );
    });

    return () => {
      cancelled = true;
      unsubAuth();
      if (unsubProfile) unsubProfile();
      if (unsubChats) unsubChats();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !userIsAdmin) {
      setAdminUsersList([]);
      setAdminAnalytics({ totalVisits: 0, registeredUsersCount: 0 });
      setAdminQuotaAnalytics({
        cycleStartedAt: getPacificCycleStartMs(),
        ptDateKey: getPacificDateKey(),
        plusPlusUsed: 0,
        plusUsed: 0,
        plusPlusChars: 0,
        plusChars: 0
      });
      return undefined;
    }

    const unsubAdmin = subscribeAdminDashboardData({
      onUsers: (rows) => setAdminUsersList(rows),
      onAnalytics: (stats) => setAdminAnalytics(stats),
      onQuotaAnalytics: (qStats) => setAdminQuotaAnalytics(qStats),
      onError: (err) => {
        console.error('Admin dashboard subscription error:', err);
      }
    });

    return () => unsubAdmin();
  }, [authReady, userIsAdmin]);

  const syncServerQuota = useCallback(async () => {
    try {
      const response = await fetch('/api/quota', { cache: 'no-store' });
      if (!response.ok) return;
      const serverMeta = await response.json().catch(() => null);
      if (!serverMeta || typeof serverMeta.validKeyCount !== 'number') return;

      const plusPlusMeta = serverMeta?.models?.[SUPER_MODEL_TIER] || serverMeta;
      const plusMeta = serverMeta?.models?.[FAST_MODEL_TIER] || {
        validKeyCount: serverMeta.validKeyCount,
        exhaustedKeyCount: 0,
        quotaPerKey: PLUS_QUOTA_PER_KEY
      };

      setDailyQuota((prev) => {
        const next = reconcileQuotaState(
          prev || loadDailyQuotaState(undefined, QUOTA_STORAGE_KEY),
          plusPlusMeta,
          Date.now()
        );
        saveDailyQuotaState(next, undefined, QUOTA_STORAGE_KEY);
        setGlobalCapacityExhausted(next.validKeyCount > 0 && next.remaining === 0);
        return next;
      });
      setPlusDailyQuota((prev) => {
        const next = reconcileQuotaState(
          prev || loadDailyQuotaState(undefined, PLUS_QUOTA_STORAGE_KEY),
          { ...plusMeta, quotaPerKey: plusMeta.quotaPerKey || PLUS_QUOTA_PER_KEY },
          Date.now()
        );
        saveDailyQuotaState(next, undefined, PLUS_QUOTA_STORAGE_KEY);
        return next;
      });
    } catch {
      setDailyQuota((prev) => {
        const base = prev || loadDailyQuotaState(undefined, QUOTA_STORAGE_KEY);
        if (!base) return prev;
        const next = reconcileQuotaState(base, {}, Date.now());
        saveDailyQuotaState(next, undefined, QUOTA_STORAGE_KEY);
        setGlobalCapacityExhausted(next.validKeyCount > 0 && next.remaining === 0);
        return next;
      });
      setPlusDailyQuota((prev) => {
        const base = prev || loadDailyQuotaState(undefined, PLUS_QUOTA_STORAGE_KEY);
        if (!base) return prev;
        const next = reconcileQuotaState(base, { quotaPerKey: PLUS_QUOTA_PER_KEY }, Date.now());
        saveDailyQuotaState(next, undefined, PLUS_QUOTA_STORAGE_KEY);
        return next;
      });
    }
  }, []);

  const handleRefreshAdminDashboard = useCallback(async () => {
    const tasks = [syncServerQuota()];
    if (userIsAdmin) {
      tasks.push(
        fetchAdminDashboardData().then((fresh) => {
          if (Array.isArray(fresh?.users)) {
            setAdminUsersList(fresh.users);
          }
          if (fresh?.analytics) {
            setAdminAnalytics(fresh.analytics);
          }
          if (fresh?.quotaAnalytics) {
            setAdminQuotaAnalytics(fresh.quotaAnalytics);
          }
        })
      );
    }
    await Promise.all(tasks);
  }, [syncServerQuota, userIsAdmin]);

  useEffect(() => {
    syncServerQuota();
    const intervalId = window.setInterval(() => {
      setDailyQuota((prev) => {
        if (!prev) return prev;
        const next = reconcileQuotaState(prev, {}, Date.now());
        if (next.cycleStartedAt !== prev.cycleStartedAt || next.remaining !== prev.remaining) {
          saveDailyQuotaState(next, undefined, QUOTA_STORAGE_KEY);
          setGlobalCapacityExhausted(next.validKeyCount > 0 && next.remaining === 0);
          return next;
        }
        return prev;
      });
      setPlusDailyQuota((prev) => {
        if (!prev) return prev;
        const next = reconcileQuotaState(prev, { quotaPerKey: PLUS_QUOTA_PER_KEY }, Date.now());
        if (next.cycleStartedAt !== prev.cycleStartedAt || next.remaining !== prev.remaining) {
          saveDailyQuotaState(next, undefined, PLUS_QUOTA_STORAGE_KEY);
          return next;
        }
        return prev;
      });
      setCredits((prev) => {
        const now = Date.now();
        const today = getLocalDateKey(new Date(now));
        const limit = clampDailyLimit(userProfile?.dailyLimit || prev.dailyLimit);
        if (!isCreditsCycleExpired(prev, today, now)) return prev;
        if (currentUser?.uid && userProfile) {
          renewExpiredCycleInFirestore(currentUser.uid, userProfile).catch(() => {});
        }
        return normalizeCreditsState(prev, today, now, limit);
      });
    }, 30000);

    const handleVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        syncServerQuota();
        setCredits((prev) => {
          const now = Date.now();
          const today = getLocalDateKey(new Date(now));
          const limit = clampDailyLimit(userProfile?.dailyLimit || prev.dailyLimit);
          if (!isCreditsCycleExpired(prev, today, now)) return prev;
          if (currentUser?.uid && userProfile) {
            renewExpiredCycleInFirestore(currentUser.uid, userProfile).catch(() => {});
          }
          return normalizeCreditsState(prev, today, now, limit);
        });
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [syncServerQuota, currentUser?.uid, userProfile]);

  useEffect(() => enableChatAutoScroll(), []);

  useEffect(() => {
    if (!attachMenuOpen) return undefined;
    const handleOutsideClick = (event) => {
      if (event.target instanceof Element && !event.target.closest('.attachment-menu-wrap')) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [attachMenuOpen]);

  useEffect(() => {
    if (!modelMenuOpen) return undefined;
    const handleOutsideClick = (event) => {
      if (event.target instanceof Element && !event.target.closest('.model-dropdown-wrap')) {
        setModelMenuOpen(false);
      }
    };
    const handleKeyDownClose = (event) => {
      if (event.key === 'Escape') setModelMenuOpen(false);
    };
    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDownClose);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDownClose);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [activeChatId, messages.length, isSending]);

  const commitChatRename = useCallback((chatId, rawTitle) => {
    const nextTitle = typeof rawTitle === 'string' ? rawTitle.trim().slice(0, 80) : '';
    setRenamingChatId(null);
    setRenamingTitle('');
    if (!chatId || !nextTitle) return;
    const uid = currentUser?.uid || '';
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId || chat.title === nextTitle) return chat;
        const updated = { ...chat, title: nextTitle, updatedAt: Date.now() };
        if (uid) syncChatToCloud(uid, updated);
        return updated;
      })
    );
  }, [currentUser?.uid, syncChatToCloud]);

  useEffect(() => {
    const handleExternalRename = (event) => {
      const detail = event?.detail;
      const nextTitle = typeof detail?.title === 'string' ? detail.title.trim().slice(0, 80) : '';
      if (!nextTitle) return;
      const uid = currentUser?.uid || '';
      setChats((prev) =>
        prev.map((chat) => {
          const matches = (detail.chatId && chat.id === detail.chatId)
            || (!detail.chatId && chat.title === detail.previousTitle);
          if (!matches) return chat;
          const updated = { ...chat, title: nextTitle, updatedAt: Date.now() };
          if (uid) syncChatToCloud(uid, updated);
          return updated;
        })
      );
    };
    window.addEventListener('zaka-chat-rename', handleExternalRename);
    return () => window.removeEventListener('zaka-chat-rename', handleExternalRename);
  }, [currentUser?.uid, syncChatToCloud]);

  const stopVoiceDictation = useCallback((abortImmediately = false) => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        if (abortImmediately && typeof recognition.abort === 'function') {
          recognition.abort();
        } else if (typeof recognition.stop === 'function') {
          recognition.stop();
        }
      } catch {
        // Ignore stop errors on already-ended recognition sessions.
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => {
      stopVoiceDictation(true);
    };
  }, [stopVoiceDictation]);

  useEffect(() => {
    if (isListening) {
      stopVoiceDictation(true);
    }
  }, [langMeta.code]);

  function handleToggleVoiceDictation() {
    if (isListening) {
      const committed = voiceLatestTextRef.current || mergeDictatedText(voiceBaseTextRef.current, voiceFinalTextRef.current, '');
      stopVoiceDictation(false);
      setInput(committed);
      voiceBaseTextRef.current = committed;
      messageInputRef.current?.focus();
      return;
    }

    const SpeechRecognitionCtor = getSpeechRecognitionConstructor(
      typeof window !== 'undefined' ? window : null
    );
    if (!SpeechRecognitionCtor) {
      setError(t.voiceUnsupported);
      return;
    }

    setError('');
    voiceBaseTextRef.current = input;
    voiceFinalTextRef.current = '';
    voiceLatestTextRef.current = input;

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = resolveSpeechLocale(langMeta.code);
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        const { finalText, interimText } = extractSpeechTranscript(event?.results);
        voiceFinalTextRef.current = finalText;
        const nextValue = mergeDictatedText(voiceBaseTextRef.current, finalText, interimText);
        voiceLatestTextRef.current = nextValue;
        setInput(nextValue);
      };

      recognition.onerror = (event) => {
        const errKey = mapSpeechErrorToKey(event?.error);
        if (errKey && t[errKey]) {
          setError(t[errKey]);
        }
        stopVoiceDictation(true);
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
          setIsListening(false);
          const finalized = mergeDictatedText(voiceBaseTextRef.current, voiceFinalTextRef.current, '');
          if (finalized !== voiceBaseTextRef.current) {
            setInput(finalized);
          }
        }
      };

      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setError(t.voiceGenericError);
    }
  }

  function updateSetting(key, value) {
    setSettings((prev) => normalizeSettings({ ...prev, [key]: value }));
  }

  function updateMessageInChat(chatId, messageId, updater, { syncCloud = false } = {}) {
    const uid = currentUser?.uid || '';
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        const updated = {
          ...chat,
          updatedAt: Date.now(),
          messages: chat.messages.map((m) => (m.id === messageId ? updater(m) : m))
        };
        if (syncCloud && uid) syncChatToCloud(uid, updated);
        return updated;
      })
    );
  }

  function handleNewChat() {
    setActiveChatId(null);
    setError('');
    setCreditsExhaustedHighlight(false);
    setSidebarOpen(false);
  }

  function openAuthDialog(mode = 'login', prompt = '') {
    setAuthModalMode(mode);
    setAuthPromptMessage(prompt);
    setAuthModalOpen(true);
    setSidebarOpen(false);
  }

  async function handleSignOut() {
    try {
      stopVoiceDictation(true);
      setLoadedScopeKey(null);
      setChats([]);
      setActiveChatId(null);
      setInput('');
      setAttachments([]);
      setHistoryQuery('');
      setRenamingChatId(null);
      setRenamingTitle('');
      setCreditsExhaustedHighlight(false);
      knownRemoteChatIdsRef.current = new Set();
      deletedChatIdsRef.current = new Set();
      setAdminModalOpen(false);
      setSidebarOpen(false);
      setError('');
      await signOut(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.genericError);
    }
  }

  useEffect(() => {
    return () => {
      if (shareTimerRef.current) {
        window.clearTimeout(shareTimerRef.current);
      }
    };
  }, []);

  async function handleShareApp() {
    if (shareTimerRef.current) {
      window.clearTimeout(shareTimerRef.current);
      shareTimerRef.current = null;
    }
    const payload = buildSharePayload(t, typeof window !== 'undefined' ? window.location : null);
    const result = await shareOrCopyApp({ payload });
    if (result.aborted) {
      return;
    }
    if (result.ok) {
      setShareStatus({
        isError: false,
        message: result.method === 'web-share' ? t.shareAppSharedStatus : t.shareAppCopiedStatus
      });
    } else {
      setShareStatus({
        isError: true,
        message: t.shareAppErrorStatus
      });
    }
    shareTimerRef.current = window.setTimeout(() => {
      setShareStatus(null);
      shareTimerRef.current = null;
    }, 4500);
  }

  function handleSelectChat(chatId) {
    setActiveChatId(chatId);
    setError('');
    setSidebarOpen(false);
  }

  function handleDeleteChat(chatId) {
    if (renamingChatId === chatId) {
      setRenamingChatId(null);
      setRenamingTitle('');
    }
    deletedChatIdsRef.current.add(chatId);
    knownRemoteChatIdsRef.current.delete(chatId);
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== chatId);
      if (activeChatId === chatId) {
        setActiveChatId(next[0]?.id || null);
      }
      return next;
    });
    if (currentUser?.uid) {
      deleteUserChatInFirestore(currentUser.uid, chatId).catch((err) => {
        console.error('Failed deleting chat from Firestore:', err);
      });
    }
  }

  async function handleClearHistory() {
    const existingIds = chatsRef.current.map((c) => c.id);
    for (const id of existingIds) {
      deletedChatIdsRef.current.add(id);
      knownRemoteChatIdsRef.current.delete(id);
    }
    setChats([]);
    setActiveChatId(null);
    setSettingsOpen(false);
    await clearOfflineChats(settings, activeScopeKey);
    if (currentUser?.uid && existingIds.length > 0) {
      clearUserChatsInFirestore(currentUser.uid, existingIds).catch((err) => {
        console.error('Failed clearing user chats in Firestore:', err);
      });
    }
  }

  async function handleFileSelect(event) {
    setAttachMenuOpen(false);
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      setError(t.maxAttachmentsError);
      return;
    }

    const nextItems = [];
    for (const file of files) {
      const isValidType = file.type.startsWith('image/') || file.type === 'application/pdf';
      if (!isValidType) {
        setError(t.fileTypeError);
        return;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(t.fileSizeError);
        return;
      }
      const data = await readFileAsDataUrl(file);
      nextItems.push({
        id: createId('file'),
        name: file.name,
        mimeType: file.type,
        data
      });
    }

    setError('');
    setAttachments((prev) => [...prev, ...nextItems]);
  }

  function removeAttachment(id) {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleDownloadImage(url) {
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const mimeExt = blob.type?.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'jpg';
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `zaka-plus-${Date.now()}.${mimeExt}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      const link = document.createElement('a');
      link.href = url;
      link.download = `zaka-plus-${Date.now()}.jpg`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isListening) {
      stopVoiceDictation(true);
    }
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || isSending) return;

    if (!isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      setIsOnline(false);
      setError(t.offlineSendError);
      return;
    }

    if (!currentUser) {
      openAuthDialog('login', t.authRequiredToSend);
      return;
    }

    const nowMs = Date.now();
    const todayKey = getLocalDateKey(new Date(nowMs));
    const userLimit = clampDailyLimit(userProfile?.dailyLimit || credits.dailyLimit);
    const currentCredits = normalizeCreditsState(credits, todayKey, nowMs, userLimit);
    if (
      currentCredits.remaining !== credits.remaining
      || currentCredits.lastResetDate !== credits.lastResetDate
      || currentCredits.cycleStartedAt !== credits.cycleStartedAt
    ) {
      setCredits(currentCredits);
    }
    const wantsImage = imageMode || (trimmed && isImageGenerationRequest(trimmed));
    if (wantsImage && currentCredits.remaining <= 0) {
      setCreditsExhaustedHighlight(true);
      setError('');
      return;
    }

    const useFallbackMode = shouldUseFallbackLiteModel({
      creditsRemaining: currentCredits.remaining,
      globalCapacityExhausted,
      wantsImage,
      selectedModel: activeModelTier
    });

    const userText = trimmed || '📎';
    const now = Date.now();
    const userMessage = {
      id: createId('msg'),
      role: 'user',
      content: userText,
      createdAt: now,
      attachments: attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
    };

    const ownerUid = currentUser.uid;
    let targetChatId = activeChatId;
    let existingMessages = messages;
    let chatAfterUserMsg = null;

    if (!targetChatId) {
      targetChatId = createId('chat');
      const title = userText.slice(0, 48) || t.defaultChatTitle;
      const newChat = {
        id: targetChatId,
        title,
        createdAt: now,
        updatedAt: now,
        messages: [userMessage]
      };
      chatAfterUserMsg = newChat;
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(targetChatId);
      existingMessages = [];
    } else {
      const existingChat = chatsRef.current.find((c) => c.id === targetChatId);
      if (existingChat) {
        chatAfterUserMsg = {
          ...existingChat,
          updatedAt: now,
          title: existingChat.messages.length === 0 ? userText.slice(0, 48) : existingChat.title,
          messages: [...existingChat.messages, userMessage]
        };
      }
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === targetChatId
            ? {
                ...chat,
                updatedAt: now,
                title: chat.messages.length === 0 ? userText.slice(0, 48) : chat.title,
                messages: [...chat.messages, userMessage]
              }
            : chat
        )
      );
    }

    if (chatAfterUserMsg) {
      syncChatToCloud(ownerUid, chatAfterUserMsg);
    }

    const outgoingAttachments = attachments.map(({ mimeType, data }) => ({ mimeType, data }));
    setInput('');
    setAttachments([]);
    setError('');
    setCreditsExhaustedHighlight(false);

    if (wantsImage && trimmed) {
      const imageMessageId = createId('msg');
      const pendingMessage = {
        id: imageMessageId,
        role: 'assistant',
        type: 'image',
        content: '',
        prompt: trimmed,
        englishPrompt: '',
        imageUrl: '',
        imageModel: 'flux',
        imageSeed: null,
        imageLoading: true,
        imageError: false,
        imageErrorMessage: '',
        createdAt: Date.now()
      };

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === targetChatId
            ? { ...chat, updatedAt: Date.now(), messages: [...chat.messages, pendingMessage] }
            : chat
        )
      );

      try {
        const result = await generateImageViaApi(trimmed);
        updateMessageInChat(
          targetChatId,
          imageMessageId,
          (m) => ({
            ...m,
            englishPrompt: result.englishPrompt,
            imageUrl: result.imageUrl,
            imageSeed: result.seed,
            imageModel: result.model || 'flux',
            imageError: false,
            imageErrorMessage: ''
          }),
          { syncCloud: true }
        );
        setCredits((prev) => {
          const limit = clampDailyLimit(userProfile?.dailyLimit || prev.dailyLimit);
          const next = consumeOneCredit(prev, getLocalDateKey(), Date.now(), limit);
          saveCreditsState(next, getUserCreditsStorageKey(currentUser?.uid || ''));
          return next;
        });
        if (currentUser?.uid && userProfile) {
          consumeUserCreditInFirestore(currentUser.uid, userProfile).catch((consumeErr) => {
            console.error('Failed syncing consumed image credit:', consumeErr);
          });
        }
        scrollToBottom();
      } catch (err) {
        const rawErrMsg = err instanceof Error && err.message ? err.message : '';
        const friendlyErr = isQuotaExhaustedResponse(0, null, rawErrMsg)
          ? t.globalQuotaExhaustedMessage
          : (rawErrMsg || t.imageLoadError);
        if (isQuotaExhaustedResponse(0, null, rawErrMsg)) {
          setGlobalCapacityExhausted(true);
        }
        updateMessageInChat(
          targetChatId,
          imageMessageId,
          (m) => ({
            ...m,
            imageLoading: false,
            imageError: true,
            imageErrorMessage: friendlyErr
          }),
          { syncCloud: true }
        );
      }
      return;
    }

    setIsSending(true);
    try {
      const historyPayload = buildChatHistoryPayload([...existingMessages, userMessage], 10);
      if (historyPayload.length === 0) {
        return;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: historyPayload,
          attachments: outgoingAttachments.length ? outgoingAttachments : undefined,
          systemInstruction: settings.systemInstruction.trim() || undefined,
          selectedModel: activeModelTier,
          model: useFallbackMode ? GEMINI_FALLBACK_LITE_MODEL_ID : GEMINI_HYDROGEN_MODEL_ID,
          useFallbackOnly: useFallbackMode,
          deepThinking: settings.deepThinking
        })
      });

      const rawText = await response.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }

      const readableRaw = rawText
        ? rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260)
        : '';

      if (!response.ok) {
        if (data?.quotaMeta && typeof data.quotaMeta === 'object') {
          setDailyQuota((prev) => {
            const base = prev || loadDailyQuotaState();
            const next = applyMessageSendQuota(base, {
              ...data.quotaMeta,
              succeeded: false
            }, Date.now());
            saveDailyQuotaState(next);
            return next;
          });
        }
        const serverErr = data?.error || data?.message || readableRaw;
        if (isQuotaExhaustedResponse(response.status, data, serverErr)) {
          setGlobalCapacityExhausted(true);
          throw new Error(t.globalQuotaExhaustedMessage);
        }
        throw new Error(serverErr || t.genericError);
      }

      const replyText = typeof data?.reply === 'string'
        ? data.reply.trim()
        : (typeof data?.text === 'string' ? data.text.trim() : '');
      if (!replyText) {
        throw new Error(data?.error || data?.message || t.genericError);
      }

      const usedFallback = Boolean(data?.usedFallback);
      const primaryExhausted = Boolean(data?.primaryCapacityExhausted);
      const usedPlusPlus = data?.usedTier === SUPER_MODEL_TIER
        || (!data?.usedTier && !usedFallback && data?.model === GEMINI_HYDROGEN_MODEL_ID);
      const consumedChars = calculateExchangeCharCount(trimmed, replyText);
      setGlobalCapacityExhausted(primaryExhausted || (useFallbackMode && globalCapacityExhausted));

      if (usedPlusPlus) {
        const plusPlusMeta = data?.quotaMeta && typeof data.quotaMeta === 'object'
          ? {
              ...data.quotaMeta,
              reachedModel: true,
              succeeded: true,
              charsCount: consumedChars
            }
          : {
              reachedModel: true,
              succeeded: true,
              charsCount: consumedChars
            };
        setDailyQuota((prev) => {
          const base = prev || loadDailyQuotaState(undefined, QUOTA_STORAGE_KEY);
          const next = applyMessageSendQuota(base, plusPlusMeta, Date.now());
          saveDailyQuotaState(next, undefined, QUOTA_STORAGE_KEY);
          return next;
        });
      } else {
        if (data?.quotaMeta && typeof data.quotaMeta === 'object' && !useFallbackMode) {
          setDailyQuota((prev) => {
            const base = prev || loadDailyQuotaState(undefined, QUOTA_STORAGE_KEY);
            const next = applyMessageSendQuota(base, {
              ...data.quotaMeta,
              reachedModel: true,
              succeeded: false
            }, Date.now());
            saveDailyQuotaState(next, undefined, QUOTA_STORAGE_KEY);
            return next;
          });
        }
        const plusMeta = data?.plusQuotaMeta && typeof data.plusQuotaMeta === 'object'
          ? {
              ...data.plusQuotaMeta,
              quotaPerKey: data.plusQuotaMeta.quotaPerKey || PLUS_QUOTA_PER_KEY,
              reachedModel: true,
              succeeded: true,
              charsCount: consumedChars
            }
          : {
              quotaPerKey: PLUS_QUOTA_PER_KEY,
              reachedModel: true,
              succeeded: true,
              charsCount: consumedChars
            };
        setPlusDailyQuota((prev) => {
          const base = prev || loadDailyQuotaState(undefined, PLUS_QUOTA_STORAGE_KEY);
          const next = applyMessageSendQuota(base, plusMeta, Date.now());
          saveDailyQuotaState(next, undefined, PLUS_QUOTA_STORAGE_KEY);
          return next;
        });
      }

      if (currentUser?.uid) {
        recordModelUsageInFirestore(usedPlusPlus ? SUPER_MODEL_TIER : FAST_MODEL_TIER, consumedChars)
          .then((updatedQuotaDoc) => {
            if (updatedQuotaDoc && userIsAdmin) {
              setAdminQuotaAnalytics(updatedQuotaDoc);
            }
          })
          .catch((quotaSyncErr) => {
            console.error('Failed syncing model usage counter to Firestore:', quotaSyncErr);
          });
      }

      if (shouldDeductCreditForReply({ usedFallback })) {
        let remainingAfterSend = credits.remaining;
        setCredits((prev) => {
          const limit = clampDailyLimit(userProfile?.dailyLimit || prev.dailyLimit);
          const next = consumeOneCredit(prev, getLocalDateKey(), Date.now(), limit);
          remainingAfterSend = next.remaining;
          saveCreditsState(next, getUserCreditsStorageKey(currentUser?.uid || ''));
          return next;
        });
        if (remainingAfterSend <= 0 && activeModelTier !== FAST_MODEL_TIER) {
          updateSetting('selectedModel', FAST_MODEL_TIER);
        }
        if (currentUser?.uid && userProfile) {
          consumeUserCreditInFirestore(currentUser.uid, userProfile).catch((consumeErr) => {
            console.error('Failed syncing consumed message credit:', consumeErr);
          });
        }
      } else if (usedFallback && activeModelTier !== FAST_MODEL_TIER) {
        updateSetting('selectedModel', FAST_MODEL_TIER);
      }

      const safeSources = sanitizeClientSources(data?.sources);
      const assistantMessage = {
        id: createId('msg'),
        role: 'assistant',
        content: replyText,
        ...(safeSources.length > 0 ? { sources: safeSources } : {}),
        createdAt: Date.now()
      };

      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== targetChatId) return chat;
          const updated = {
            ...chat,
            updatedAt: Date.now(),
            messages: [...chat.messages, assistantMessage]
          };
          if (activeScopeRef.current === getUserChatScopeKey(ownerUid)) {
            syncChatToCloud(ownerUid, updated);
          }
          return updated;
        })
      );
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : t.genericError;
      if (isQuotaExhaustedResponse(0, null, msg)) {
        setGlobalCapacityExhausted(true);
        setError(t.globalQuotaExhaustedMessage);
      } else {
        setError(msg);
      }
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composerRef.current?.requestSubmit();
    }
  }

  function handleImageLoad(chatId, messageId) {
    updateMessageInChat(
      chatId,
      messageId,
      (m) => ({
        ...m,
        imageLoading: false,
        imageError: false
      }),
      { syncCloud: true }
    );
    scrollToBottom();
  }

  function handleImageError(chatId, msg) {
    if (msg.imageModel !== 'turbo' && msg.englishPrompt) {
      const retrySeed = Math.floor(Math.random() * 100000);
      const fallbackUrl = buildPollinationsImageUrl(msg.englishPrompt, {
        width: 768,
        height: 768,
        model: 'turbo',
        nologo: true,
        seed: retrySeed
      });
      updateMessageInChat(chatId, msg.id, (m) => ({
        ...m,
        imageModel: 'turbo',
        imageSeed: retrySeed,
        imageUrl: fallbackUrl
      }));
      return;
    }
    updateMessageInChat(
      chatId,
      msg.id,
      (m) => ({
        ...m,
        imageLoading: false,
        imageError: true,
        imageErrorMessage: m.imageErrorMessage || t.imageLoadError
      }),
      { syncCloud: true }
    );
  }

  return (
    <div
      className={`chat-app ${settings.darkMode ? 'chat-dark' : ''}`}
      dir={langMeta.dir}
      data-online={isOnline ? 'true' : 'false'}
    >
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      <aside className={`chat-sidebar ${sidebarOpen ? 'sidebar-visible' : ''}`}>
        <div className="sidebar-heading">
          <div className="sidebar-brand">
            <img src="/logo.png?v=6" alt="Plus AI" width="28" height="28" />
            <span>{t.shortBrand}</span>
          </div>
          <button
            type="button"
            className="ui-icon-button sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>

        <button type="button" className="new-chat-button" onClick={handleNewChat}>
          <PlusIcon />
          <span>{t.newChat}</span>
        </button>

        <div className="history-search-wrap">
          <span className="history-search-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            type="search"
            className="history-search-input"
            value={historyQuery}
            onChange={(e) => setHistoryQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchLabel}
          />
          {historyQuery && (
            <button
              type="button"
              className="history-search-clear"
              onClick={() => setHistoryQuery('')}
              aria-label={t.clearSearch}
            >
              ×
            </button>
          )}
        </div>

        <div className="history-label">{t.history}</div>
        <div className="chat-history">
          {chats.length === 0 ? (
            <div className="history-empty">{t.emptyHistory}</div>
          ) : filteredChats.length === 0 ? (
            <div className="history-empty">{t.noSearchResults}</div>
          ) : (
            filteredChats.map((chat) => {
              const isRenaming = renamingChatId === chat.id;
              return (
                <div
                  key={chat.id}
                  className={`history-entry ${chat.id === activeChatId ? 'history-entry-active' : ''} ${isRenaming ? 'history-entry-renaming' : ''}`}
                >
                  {isRenaming ? (
                    <div className="history-rename-box" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={renameInputRef}
                        type="text"
                        dir="auto"
                        maxLength={80}
                        className="history-rename-input"
                        data-testid="history-rename-input"
                        aria-label={t.renameChatLabel}
                        value={renamingTitle}
                        onChange={(e) => setRenamingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitChatRename(chat.id, renamingTitle);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setRenamingChatId(null);
                            setRenamingTitle('');
                          }
                        }}
                        onBlur={() => commitChatRename(chat.id, renamingTitle)}
                      />
                      <button
                        type="button"
                        className="history-rename-save"
                        data-testid="history-rename-save"
                        aria-label={t.saveRenameLabel}
                        title={t.saveRenameLabel}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => commitChatRename(chat.id, renamingTitle)}
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="history-select"
                        data-chat-id={chat.id}
                        onClick={() => handleSelectChat(chat.id)}
                      >
                        <span className="history-text">{chat.title}</span>
                        <span className="history-count">{chat.messages.length}</span>
                      </button>
                      <button
                        type="button"
                        className="history-rename"
                        data-testid={`rename-chat-${chat.id}`}
                        aria-label={`${t.renameChatLabel} ${chat.title}`}
                        title={t.renameChatLabel}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingChatId(chat.id);
                          setRenamingTitle(chat.title || '');
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="history-delete"
                        onClick={() => handleDeleteChat(chat.id)}
                        aria-label={`Delete ${chat.title}`}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="sidebar-account-box" data-testid="sidebar-account-box">
          {currentUser ? (
            <>
              <div className="sidebar-account-row">
                <div className="sidebar-avatar-badge" aria-hidden="true">
                  {sanitizeDisplayName(userProfile?.displayName || currentUser.displayName, currentUser.email).charAt(0)}
                </div>
                <div className="sidebar-account-meta">
                  <div className="sidebar-account-name-row">
                    <span className="sidebar-account-name">
                      {sanitizeDisplayName(userProfile?.displayName || currentUser.displayName, currentUser.email)}
                    </span>
                    <span className={`sidebar-plan-tag plan-${normalizePlan(userProfile?.plan)}`}>
                      {normalizePlan(userProfile?.plan) === 'vip'
                        ? 'VIP'
                        : (normalizePlan(userProfile?.plan) === 'pro' ? t.planPro : t.planFree)}
                    </span>
                  </div>
                  <span className="sidebar-account-email">{currentUser.email}</span>
                </div>
              </div>

              {userIsUnverifiedAdmin && (
                <div className="auth-error" role="status">
                  {t.adminVerifyEmailNotice}
                </div>
              )}

              <div className="sidebar-account-actions">
                {userIsAdmin && (
                  <button
                    type="button"
                    className="sidebar-admin-button"
                    data-testid="admin-panel-button"
                    onClick={() => {
                      setAdminModalOpen(true);
                      setSidebarOpen(false);
                    }}
                  >
                    <span>🛡️</span>
                    <span>{t.adminPanelButton}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="sidebar-logout-button"
                  data-testid="logout-button"
                  onClick={handleSignOut}
                >
                  {t.authLogoutButton}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="sidebar-auth-button"
              data-testid="sidebar-auth-button"
              onClick={() => openAuthDialog('login')}
            >
              {t.authLoginOrSignup}
            </button>
          )}
        </div>

        <div className="sidebar-share-wrap">
          <button
            type="button"
            className="sidebar-share-button"
            data-testid="share-app-button"
            onClick={handleShareApp}
          >
            <ShareIcon />
            <span>{t.shareAppButton}</span>
          </button>
          {shareStatus && (
            <div
              className={`sidebar-share-status ${shareStatus.isError ? 'share-status-error' : ''}`}
              data-testid="share-app-status"
              role="status"
              aria-live="polite"
            >
              {shareStatus.message}
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-settings-button"
            onClick={() => {
              setSettingsOpen(true);
              setSidebarOpen(false);
            }}
          >
            <SettingsIcon />
            <span>{t.settings}</span>
          </button>
          <span
            className={`model-status-dot ${isOnline ? '' : 'status-dot-offline'}`}
            title={isOnline ? t.assistantLabel : t.offlineBanner}
          />
        </div>
      </aside>

      <header className="chat-header">
        <button
          type="button"
          className="ui-icon-button header-menu-button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label="Open menu"
        >
          <MenuIcon />
        </button>

        <div className="header-brand">
          <img src="/logo.png?v=6" alt="Plus AI" width="34" height="34" />
          <span>{t.brand}</span>
        </div>

        <div className="header-actions">
          {!currentUser && (
            <button
              type="button"
              className="header-auth-button"
              data-testid="header-auth-button"
              onClick={() => openAuthDialog('login')}
            >
              {t.authLoginCta}
            </button>
          )}
          <button
            type="button"
            className="ui-icon-button theme-button"
            onClick={() => updateSetting('darkMode', !settings.darkMode)}
            aria-label={t.darkModeLabel}
          >
            {settings.darkMode ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="chat-main">
        {!isOnline && (
          <div className="offline-banner" role="status">
            <span className="offline-dot" aria-hidden="true" />
            <span>{t.offlineBanner}</span>
          </div>
        )}

        <div className={`conversation-area ${messages.length === 0 ? 'conversation-empty' : ''}`}>
          {messages.length === 0 ? (
            <div className="welcome-card">
              <img className="welcome-logo" src="/logo.png?v=6" alt="Plus AI" />
              <h1>{t.welcomeTitle}</h1>
              <p>{t.welcomeSubtitle}</p>
              {!currentUser && (
                <div className="welcome-auth-cta">
                  <div className="welcome-auth-note">{t.authWelcomePrompt}</div>
                  <button
                    type="button"
                    className="welcome-auth-button"
                    data-testid="welcome-auth-button"
                    onClick={() => openAuthDialog('login')}
                  >
                    {t.authLoginOrSignup}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="message-list">
              {messages
                .filter((msg) => msg.type === 'image' || Boolean(msg.content?.trim()) || (Array.isArray(msg.attachments) && msg.attachments.length > 0))
                .map((msg) => (
                <div
                  key={msg.id}
                  className={`message-row ${msg.role === 'user' ? 'message-user' : 'message-assistant'}`}
                >
                  {msg.role === 'assistant' && (
                    <img className="message-avatar" src="/logo.png?v=6" alt="Plus AI" width="30" height="30" />
                  )}
                  <div className="message-bubble">
                    <div className="message-author">
                      {msg.role === 'user' ? t.userLabel : t.assistantLabel}
                    </div>
                    {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                      <div className="message-attachments">
                        {msg.attachments.map((file, idx) =>
                          file.mimeType?.startsWith('image/') && file.data ? (
                            <img key={idx} src={file.data} alt={file.name} />
                          ) : (
                            <span key={idx} className="attachment-file-label">
                              {file.mimeType?.startsWith('image/') ? 'IMG' : 'PDF'} · {file.name}
                            </span>
                          )
                        )}
                      </div>
                    )}
                    {msg.type === 'image' ? (
                      <div className="generated-image-card">
                        {msg.imageLoading && (
                          <div className="image-generation-status" data-state="loading" role="status">
                            {t.generatingImage}
                          </div>
                        )}
                        {msg.imageError ? (
                          <div className="image-generation-status" data-state="error" role="status">
                            {msg.imageErrorMessage || t.imageLoadError}
                          </div>
                        ) : msg.imageUrl ? (
                          <img
                            src={msg.imageUrl}
                            alt={msg.prompt || t.imageAlt}
                            className={msg.imageLoading ? 'image-generation-pending' : 'image-generation-ready'}
                            onLoad={() => handleImageLoad(activeChat.id, msg.id)}
                            onError={() => handleImageError(activeChat.id, msg)}
                          />
                        ) : null}
                        {msg.imageUrl && !msg.imageLoading && !msg.imageError && (
                          <button
                            type="button"
                            className="image-download-button"
                            onClick={() => handleDownloadImage(msg.imageUrl)}
                          >
                            <DownloadIcon />
                            <span>{t.downloadImage}</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="message-text">{msg.content}</div>
                        {msg.role === 'assistant' && (() => {
                          const msgSources = sanitizeClientSources(msg.sources);
                          if (msgSources.length === 0) return null;
                          return (
                            <div className="message-sources" data-testid="message-sources">
                              <div className="message-sources-title">{t.sourcesHeading}</div>
                              <div className="message-sources-list">
                                {msgSources.map((src, idx) => (
                                  <a
                                    key={`${src.uri}-${idx}`}
                                    href={src.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="message-source-chip"
                                  >
                                    <ExternalLinkIcon />
                                    <span>{src.title}</span>
                                  </a>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </div>
              ))}
              {isSending && (
                <div className="message-row message-assistant">
                  <img className="message-avatar" src="/logo.png?v=6" alt="Plus AI" width="30" height="30" />
                  <div className="message-bubble typing-bubble">
                    <div className="message-author">{t.assistantLabel}</div>
                    <div className="typing-indicator" aria-label="Typing">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="composer-area">
          {error && (
            <div
              className={error === t.globalQuotaExhaustedMessage ? 'global-quota-notice' : 'chat-error'}
              role="alert"
            >
              {error}
            </div>
          )}

          {credits.remaining <= 0 && (
            <div
              className={`credits-exhausted-notice ${creditsExhaustedHighlight ? 'credits-exhausted-notice-highlight' : ''}`}
              data-testid="credits-exhausted-notice"
              role="status"
            >
              <strong>{t.creditsExhaustedTitle}</strong>
              <span>{t.creditsExhaustedDevNote}</span>
              <small>{t.creditsExhaustedDesc}</small>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="pending-attachments">
              {attachments.map((file) => (
                <div key={file.id} className="pending-file">
                  {file.mimeType.startsWith('image/') ? (
                    <img src={file.data} alt={file.name} />
                  ) : (
                    <span className="pdf-badge">PDF</span>
                  )}
                  <span className="pending-file-name">{file.name}</span>
                  <button
                    type="button"
                    className="remove-attachment"
                    onClick={() => removeAttachment(file.id)}
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-tools">
            <div className="model-dropdown-wrap">
              <button
                type="button"
                className={`model-dropdown-trigger ${modelMenuOpen ? 'model-dropdown-open' : ''}`}
                data-testid="models-selector-button"
                aria-haspopup="listbox"
                aria-expanded={modelMenuOpen}
                onClick={() => setModelMenuOpen((open) => !open)}
              >
                <ModelsIcon />
                <span className="model-dropdown-caption">{t.modelsButtonLabel}:</span>
                <strong className="model-dropdown-value">{t[activeModelOption.nameKey]}</strong>
                <span className="model-dropdown-chevron" aria-hidden="true">
                  <ChevronDownIcon />
                </span>
              </button>

              {modelMenuOpen && (
                <div
                  className="model-dropdown-menu"
                  data-testid="models-selector-menu"
                  role="listbox"
                  aria-label={t.modelsButtonLabel}
                >
                  {MODEL_SELECTOR_OPTIONS.map((opt) => {
                    const isSelected = activeModelTier === opt.id;
                    const isSuperOption = opt.id !== FAST_MODEL_TIER;
                    const isSuperDepleted = isSuperOption && credits.remaining <= 0;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-model-option={opt.id}
                        className={`model-option-item ${isSelected ? 'model-option-selected' : ''} ${isSuperDepleted ? 'model-option-depleted' : ''}`}
                        onClick={() => {
                          if (isSuperDepleted) {
                            updateSetting('selectedModel', FAST_MODEL_TIER);
                            setCreditsExhaustedHighlight(true);
                            setModelMenuOpen(false);
                            return;
                          }
                          updateSetting('selectedModel', opt.id);
                          setModelMenuOpen(false);
                        }}
                      >
                        <div className="model-option-header">
                          <div className="model-option-titles">
                            <strong>{t[opt.nameKey]}</strong>
                            <span className="model-option-subtitle" dir="auto">{t[opt.subtitleKey]}</span>
                          </div>
                          {isSelected && (
                            <span className="model-option-check" aria-hidden="true">
                              <CheckIcon />
                            </span>
                          )}
                        </div>
                        <p className="model-option-desc">{t[opt.descKey]}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {isListening && (
            <div className="voice-listening-bar" role="status" aria-live="polite">
              <span className="voice-listening-status">
                <span className="voice-listening-dot" aria-hidden="true" />
                <span>{t.voiceListening}</span>
              </span>
              <button
                type="button"
                className="voice-stop-pill"
                onClick={handleToggleVoiceDictation}
              >
                {t.voiceStop}
              </button>
            </div>
          )}

          <form ref={composerRef} className="message-composer" onSubmit={handleSubmit}>
            <div className="attachment-menu-wrap">
              <button
                type="button"
                className="ui-icon-button attach-button"
                onClick={() => setAttachMenuOpen((open) => !open)}
                aria-label={t.attachImage}
              >
                <AttachIcon />
              </button>

              {attachMenuOpen && (
                <div className="attachment-menu">
                  <button type="button" onClick={() => imageInputRef.current?.click()}>
                    <span className="menu-option-icon">🖼</span>
                    <span>{t.attachImage}</span>
                  </button>
                  <button type="button" onClick={() => pdfInputRef.current?.click()}>
                    <span className="menu-option-icon">📄</span>
                    <span>{t.attachPdf}</span>
                  </button>
                </div>
              )}

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden-file-input"
                onChange={handleFileSelect}
              />
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden-file-input"
                onChange={handleFileSelect}
              />
            </div>

            <textarea
              ref={messageInputRef}
              className="message-input"
              rows={1}
              value={input}
              onChange={(e) => {
                const next = e.target.value;
                setInput(next);
                if (!isListening) {
                  voiceBaseTextRef.current = next;
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                !isOnline
                  ? t.offlinePlaceholder
                  : (imageMode ? t.imagePlaceholder : t.placeholder)
              }
            />

            <button
              type="button"
              className={`ui-icon-button mic-button ${isListening ? 'mic-button-active' : ''} ${!isSpeechSupported ? 'mic-button-unsupported' : ''}`}
              onClick={handleToggleVoiceDictation}
              disabled={isSending}
              aria-pressed={isListening}
              aria-label={isListening ? t.voiceStop : t.voiceStart}
              title={isSpeechSupported ? (isListening ? t.voiceStop : t.voiceStart) : t.voiceUnsupported}
            >
              {isListening ? <StopMicIcon /> : <MicIcon />}
            </button>

            <button
              type="submit"
              className="send-button"
              disabled={isSending || (!input.trim() && attachments.length === 0)}
              aria-label={t.send}
            >
              <SendIcon />
            </button>
          </form>

          <div className="composer-tools-bottom" data-testid="composer-tools-bottom">
            <button
              type="button"
              data-testid="deep-thinking-button"
              className={`deep-thinking-button ${settings.deepThinking ? 'deep-thinking-active' : ''}`}
              aria-pressed={settings.deepThinking}
              onClick={() => updateSetting('deepThinking', !settings.deepThinking)}
            >
              <DeepThinkIcon />
              <span>{t.deepThinking}</span>
            </button>

            <button
              type="button"
              data-testid="image-mode-button"
              className={`deep-thinking-button image-mode-button ${imageMode ? 'deep-thinking-active' : ''}`}
              aria-pressed={imageMode}
              onClick={() => setImageMode((prev) => !prev)}
            >
              <ImageCreateIcon />
              <span>{t.imageMode}</span>
            </button>

            {settings.deepThinking && (
              <span className="thinking-hint">{t.deepThinkingHint}</span>
            )}
          </div>

          <p className="composer-disclaimer">{t.disclaimer}</p>
        </div>
      </main>

      {settingsOpen && (
        <div
          className="settings-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="settings-dialog">
            <div className="settings-header">
              <h2>{t.settingsTitle}</h2>
              <button
                type="button"
                className="settings-close"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                ×
              </button>
            </div>

            <div className="settings-body">
              <div className="settings-section">
                <h3>{t.appearanceSection}</h3>
                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">{t.languageLabel}</div>
                    <small>{t.languageDesc}</small>
                  </div>
                  <select
                    value={langMeta.code}
                    aria-label={t.languageLabel}
                    onChange={(e) => updateSetting('lang', e.target.value)}
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">{t.darkModeLabel}</div>
                    <small>{t.darkModeDesc}</small>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.darkMode}
                      onChange={(e) => updateSetting('darkMode', e.target.checked)}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>

              <div className="settings-section">
                <h3>{t.modelSection}</h3>
                <div className="settings-column">
                  <label htmlFor="zaka-system-instruction">{t.systemInstructionLabel}</label>
                  <small>{t.systemInstructionDesc}</small>
                  <textarea
                    id="zaka-system-instruction"
                    value={settings.systemInstruction}
                    onChange={(e) => updateSetting('systemInstruction', e.target.value)}
                    placeholder={t.systemInstructionPlaceholder}
                  />
                </div>
              </div>

              <div className="settings-section">
                <h3>{t.creditsSection}</h3>
                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">
                      {t.creditsSettingsTitle}:{' '}
                      <strong>
                        {credits.remaining} {credits.remaining === 1 ? t.creditsUnitSingle : t.creditsUnitPlural}
                      </strong>
                    </div>
                    <small>{t.creditsSettingsDesc}</small>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3>{t.dataSection}</h3>
                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">{t.clearHistoryLabel}</div>
                    <small>{t.clearHistoryDesc}</small>
                  </div>
                  <button
                    type="button"
                    className="settings-danger"
                    onClick={handleClearHistory}
                  >
                    {t.clearHistoryButton}
                  </button>
                </div>
                <div className="settings-row">
                  <div className="settings-item-title">{t.versionLabel}</div>
                  <span className="settings-version">Plus AI 1.0</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <AuthModal
        open={authModalOpen}
        initialMode={authModalMode}
        promptMessage={authPromptMessage}
        onClose={() => {
          setAuthModalOpen(false);
          setAuthPromptMessage('');
        }}
        onSuccess={() => {
          setAuthPromptMessage('');
          setError('');
        }}
        t={t}
      />

      {userIsAdmin && (
        <AdminPanelModal
          open={adminModalOpen}
          onClose={() => setAdminModalOpen(false)}
          dailyQuota={dailyQuota}
          plusDailyQuota={plusDailyQuota}
          quotaAnalytics={adminQuotaAnalytics}
          onRefreshQuota={syncServerQuota}
          onRefreshDashboard={handleRefreshAdminDashboard}
          usersList={adminUsersList}
          analytics={adminAnalytics}
          onUpdateUserSubscription={adminUpdateUserSubscription}
          langCode={langMeta.code}
          t={t}
        />
      )}
    </div>
  );
}