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
import { GEMINI_HYDROGEN_MODEL_ID } from './shared/modelTiers.js';
import AuthModal from './components/AuthModal.jsx';
import AdminPanelModal from './components/AdminPanelModal.jsx';
import {
  LANGUAGES,
  getLanguageMeta,
  getTranslation
} from './i18n/translations.js';
import {
  clearOfflineChats,
  filterChatsByTitle,
  loadOfflineState,
  normalizeSettings,
  readLocalStorageState,
  saveOfflineState
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
  saveCreditsState
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
  consumeUserCreditInFirestore,
  renewExpiredCycleInFirestore,
  subscribeAdminDashboardData,
  subscribeUserProfile,
  syncUserProfileOnSignIn
} from './services/userAccountService.js';
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

export default function App() {
  const initialLocal = useMemo(() => readLocalStorageState(), []);
  const [chats, setChats] = useState(initialLocal.chats);
  const [activeChatId, setActiveChatId] = useState(initialLocal.activeChatId);
  const [settings, setSettings] = useState(() => normalizeSettings(initialLocal.settings));
  const [storageReady, setStorageReady] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [credits, setCredits] = useState(() => loadCreditsState());
  const [creditsExhaustedHighlight, setCreditsExhaustedHighlight] = useState(false);
  const [globalCapacityExhausted, setGlobalCapacityExhausted] = useState(false);
  const [dailyQuota, setDailyQuota] = useState(() => {
    const saved = loadDailyQuotaState();
    return saved ? reconcileQuotaState(saved, {}) : null;
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
  const [shareStatus, setShareStatus] = useState(null);
  const shareTimerRef = useRef(null);

  const imageInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const composerRef = useRef(null);
  const messageInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceBaseTextRef = useRef('');
  const voiceFinalTextRef = useRef('');
  const voiceLatestTextRef = useRef('');

  const isSpeechSupported = Boolean(
    getSpeechRecognitionConstructor(typeof window !== 'undefined' ? window : null)
  );

  const langMeta = getLanguageMeta(settings.lang);
  const t = getTranslation(langMeta.code);
  const activeChat = chats.find((c) => c.id === activeChatId) || null;
  const filteredChats = useMemo(
    () => filterChatsByTitle(chats, historyQuery),
    [chats, historyQuery]
  );
  const messages = activeChat?.messages || [];

  useEffect(() => {
    let cancelled = false;
    loadOfflineState().then((hydrated) => {
      if (cancelled) return;
      setChats(hydrated.chats);
      setActiveChatId(hydrated.activeChatId);
      setSettings(hydrated.settings);
      setStorageReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!storageReady) return;
    saveOfflineState({ chats, activeChatId, settings });
  }, [chats, activeChatId, settings, storageReady]);

  useEffect(() => {
    const storageKey = getUserCreditsStorageKey(currentUser?.uid || '');
    saveCreditsState(credits, storageKey);
  }, [credits, currentUser?.uid]);

  const userIsAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);
  const userIsUnverifiedAdmin = useMemo(() => isAdminEmailUnverified(currentUser), [currentUser]);

  useEffect(() => {
    let unsubProfile = null;
    let cancelled = false;

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (cancelled) return;
      setCurrentUser(firebaseUser || null);
      setAuthReady(true);

      if (!firebaseUser) {
        setUserProfile(null);
        setAdminModalOpen(false);
        setAdminUsersList([]);
        setCredits(loadCreditsState());
        return;
      }

      const cachedKey = getUserCreditsStorageKey(firebaseUser.uid);
      setCredits(loadCreditsState(getLocalDateKey(), Date.now(), DAILY_FREE_CREDITS, cachedKey));

      try {
        await syncUserProfileOnSignIn(firebaseUser);
      } catch (err) {
        console.error('Failed syncing user profile:', err);
      }

      if (cancelled) return;
      unsubProfile = subscribeUserProfile(
        firebaseUser.uid,
        (profileData) => {
          if (cancelled) return;
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
    });

    return () => {
      cancelled = true;
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !userIsAdmin) {
      setAdminUsersList([]);
      setAdminAnalytics({ totalVisits: 0, registeredUsersCount: 0 });
      return undefined;
    }

    const unsubAdmin = subscribeAdminDashboardData({
      onUsers: (rows) => setAdminUsersList(rows),
      onAnalytics: (stats) => setAdminAnalytics(stats),
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
      setDailyQuota((prev) => {
        const next = reconcileQuotaState(prev || loadDailyQuotaState(), serverMeta, Date.now());
        saveDailyQuotaState(next);
        setGlobalCapacityExhausted(next.validKeyCount > 0 && next.remaining === 0);
        return next;
      });
    } catch {
      setDailyQuota((prev) => {
        const base = prev || loadDailyQuotaState();
        if (!base) return prev;
        const next = reconcileQuotaState(base, {}, Date.now());
        saveDailyQuotaState(next);
        setGlobalCapacityExhausted(next.validKeyCount > 0 && next.remaining === 0);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    syncServerQuota();
    const intervalId = window.setInterval(() => {
      setDailyQuota((prev) => {
        if (!prev) return prev;
        const next = reconcileQuotaState(prev, {}, Date.now());
        if (next.cycleStartedAt !== prev.cycleStartedAt || next.remaining !== prev.remaining) {
          saveDailyQuotaState(next);
          setGlobalCapacityExhausted(next.validKeyCount > 0 && next.remaining === 0);
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
    scrollToBottom();
  }, [activeChatId, messages.length, isSending]);

  useEffect(() => {
    const handleExternalRename = (event) => {
      const detail = event?.detail;
      const nextTitle = typeof detail?.title === 'string' ? detail.title.trim().slice(0, 80) : '';
      if (!nextTitle) return;
      setChats((prev) =>
        prev.map((chat) =>
          (detail.chatId && chat.id === detail.chatId) || (!detail.chatId && chat.title === detail.previousTitle)
            ? { ...chat, title: nextTitle, updatedAt: Date.now() }
            : chat
        )
      );
    };
    window.addEventListener('zaka-chat-rename', handleExternalRename);
    return () => window.removeEventListener('zaka-chat-rename', handleExternalRename);
  }, []);

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

  function updateMessageInChat(chatId, messageId, updater) {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              updatedAt: Date.now(),
              messages: chat.messages.map((m) => (m.id === messageId ? updater(m) : m))
            }
          : chat
      )
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
      await signOut(auth);
      setAdminModalOpen(false);
      setSidebarOpen(false);
      setError('');
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
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== chatId);
      if (activeChatId === chatId) {
        setActiveChatId(next[0]?.id || null);
      }
      return next;
    });
  }

  async function handleClearHistory() {
    setChats([]);
    setActiveChatId(null);
    setSettingsOpen(false);
    await clearOfflineChats(settings);
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
    if (currentCredits.remaining <= 0) {
      setCreditsExhaustedHighlight(true);
      setError('');
      return;
    }

    const wantsImage = imageMode || (trimmed && isImageGenerationRequest(trimmed));

    const userText = trimmed || '📎';
    const now = Date.now();
    const userMessage = {
      id: createId('msg'),
      role: 'user',
      content: userText,
      createdAt: now,
      attachments: attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
    };

    let targetChatId = activeChatId;
    let existingMessages = messages;

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
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(targetChatId);
      existingMessages = [];
    } else {
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
        updateMessageInChat(targetChatId, imageMessageId, (m) => ({
          ...m,
          englishPrompt: result.englishPrompt,
          imageUrl: result.imageUrl,
          imageSeed: result.seed,
          imageModel: result.model || 'flux',
          imageError: false,
          imageErrorMessage: ''
        }));
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
        updateMessageInChat(targetChatId, imageMessageId, (m) => ({
          ...m,
          imageLoading: false,
          imageError: true,
          imageErrorMessage: friendlyErr
        }));
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
          model: GEMINI_HYDROGEN_MODEL_ID,
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

      setGlobalCapacityExhausted(false);

      const successQuotaMeta = data?.quotaMeta && typeof data.quotaMeta === 'object'
        ? { ...data.quotaMeta, reachedModel: true, succeeded: true }
        : { reachedModel: true, succeeded: true };
      setDailyQuota((prev) => {
        const base = prev || loadDailyQuotaState();
        const next = applyMessageSendQuota(base, successQuotaMeta, Date.now());
        saveDailyQuotaState(next);
        return next;
      });

      setCredits((prev) => {
        const limit = clampDailyLimit(userProfile?.dailyLimit || prev.dailyLimit);
        const next = consumeOneCredit(prev, getLocalDateKey(), Date.now(), limit);
        saveCreditsState(next, getUserCreditsStorageKey(currentUser?.uid || ''));
        return next;
      });
      if (currentUser?.uid && userProfile) {
        consumeUserCreditInFirestore(currentUser.uid, userProfile).catch((consumeErr) => {
          console.error('Failed syncing consumed message credit:', consumeErr);
        });
      }

      const assistantMessage = {
        id: createId('msg'),
        role: 'assistant',
        content: replyText,
        createdAt: Date.now()
      };

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === targetChatId
            ? { ...chat, updatedAt: Date.now(), messages: [...chat.messages, assistantMessage] }
            : chat
        )
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
    updateMessageInChat(chatId, messageId, (m) => ({
      ...m,
      imageLoading: false,
      imageError: false
    }));
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
    updateMessageInChat(chatId, msg.id, (m) => ({
      ...m,
      imageLoading: false,
      imageError: true,
      imageErrorMessage: m.imageErrorMessage || t.imageLoadError
    }));
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
            filteredChats.map((chat) => (
              <div
                key={chat.id}
                className={`history-entry ${chat.id === activeChatId ? 'history-entry-active' : ''}`}
              >
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
                  className="history-delete"
                  onClick={() => handleDeleteChat(chat.id)}
                  aria-label={`Delete ${chat.title}`}
                >
                  ×
                </button>
              </div>
            ))
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
                      <div className="message-text">{msg.content}</div>
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

          {!error && (globalCapacityExhausted || (dailyQuota && dailyQuota.validKeyCount > 0 && dailyQuota.remaining === 0)) && (
            <div className="global-quota-notice" data-testid="global-quota-banner" role="status">
              {t.globalQuotaExhaustedMessage}
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
            <button
              type="button"
              className={`deep-thinking-button ${settings.deepThinking ? 'deep-thinking-active' : ''}`}
              aria-pressed={settings.deepThinking}
              onClick={() => updateSetting('deepThinking', !settings.deepThinking)}
            >
              <span>✦</span>
              {t.deepThinking}
            </button>

            <button
              type="button"
              className={`deep-thinking-button image-mode-button ${imageMode ? 'deep-thinking-active' : ''}`}
              aria-pressed={imageMode}
              onClick={() => setImageMode((prev) => !prev)}
            >
              <span>🎨</span>
              {t.imageMode}
            </button>

            <div className="composer-counters">
              <div
                className={`credits-inline-meta ${credits.remaining === 0 ? 'credits-inline-empty' : ''}`}
                data-testid="user-credits-counter"
                role="status"
                aria-live="polite"
              >
                <span>{t.creditsRemainingLabel}:</span>
                <strong>
                  {credits.remaining} {credits.remaining === 1 ? t.creditsUnitSingle : t.creditsUnitPlural}
                </strong>
              </div>
            </div>

            {settings.deepThinking && (
              <span className="thinking-hint">{t.deepThinkingHint}</span>
            )}
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
          onRefreshQuota={syncServerQuota}
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