import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase.js';
import {
  buildInitialUserProfile,
  clampCredits,
  clampDailyLimit,
  isUserProfileCycleExpired,
  normalizePlan,
  sanitizeDisplayName
} from '../utils/authAdmin.js';
import { getLocalDateKey } from '../utils/credits.js';
import {
  doesHydrogenQuotaNeedReset,
  getLocalCalendarDateString,
  getProfileHydrogenQuotaState
} from '../utils/hydrogenQuota.js';
import {
  getPacificCycleStartMs,
  getPacificDateKey,
  isPacificCycleExpired
} from '../utils/pacificTime.js';
import { GEMINI_HYDROGEN_MODEL_ID, SUPER_MODEL_TIER } from '../shared/modelTiers.js';
import {
  normalizeChatRecord,
  prepareChatForFirestore,
  sortChatsByRecent
} from '../utils/chatStorage.js';

const VISIT_SESSION_PREFIX = 'plus-ai-visit-logged:';

async function recordGlobalAnalytics({ isNewUser = false, recordVisit = true } = {}) {
  const analyticsRef = doc(db, 'analytics', 'site');
  const visitDelta = recordVisit ? 1 : 0;
  const userDelta = isNewUser ? 1 : 0;
  if (visitDelta === 0 && userDelta === 0) return;

  try {
    await updateDoc(analyticsRef, {
      ...(visitDelta ? { totalVisits: increment(visitDelta) } : {}),
      ...(userDelta ? { registeredUsersCount: increment(userDelta) } : {}),
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    const code = err?.code || '';
    const msg = err instanceof Error ? err.message : String(err || '');
    // Firestore update rules evaluate existing().* when analytics/site does not exist yet,
    // which can yield either 'not-found' or 'permission-denied'. Fall back to setDoc in both cases.
    if (code === 'not-found' || code === 'permission-denied' || /no document to update/i.test(msg)) {
      try {
        await setDoc(analyticsRef, {
          totalVisits: visitDelta,
          registeredUsersCount: userDelta,
          updatedAt: serverTimestamp()
        });
      } catch (createErr) {
        console.warn('Global analytics init deferred:', createErr?.code || createErr?.message || createErr);
      }
      return;
    }
    console.warn('Global analytics update deferred:', code || msg);
  }
}

export async function syncUserProfileOnSignIn(firebaseUser, options = {}) {
  if (!firebaseUser?.uid) return null;
  const uid = firebaseUser.uid;
  const userRef = doc(db, 'users', uid);
  const path = `users/${uid}`;
  const preferredDisplayName = typeof options?.preferredDisplayName === 'string'
    ? options.preferredDisplayName.trim().slice(0, 100)
    : '';

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const now = Date.now();
  const todayKey = getLocalDateKey(new Date(now));
  const sessionKey = `${VISIT_SESSION_PREFIX}${uid}`;
  let alreadyLoggedSession = false;
  try {
    alreadyLoggedSession = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey) === '1';
  } catch {
    alreadyLoggedSession = false;
  }

  if (!snap.exists()) {
    const base = buildInitialUserProfile({
      uid,
      email: firebaseUser.email || '',
      displayName: preferredDisplayName || firebaseUser.displayName || '',
      now,
      todayKey
    });

    try {
      await setDoc(userRef, {
        ...base,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(sessionKey, '1');
      }
    } catch {
      // Ignore storage failures cleanly.
    }

    await recordGlobalAnalytics({ isNewUser: true, recordVisit: true });
    return base;
  }

  const existing = snap.data();
  if (existing?.banned === true) {
    return existing;
  }

  let updatedSnapshot = { ...existing };
  const dailyLimit = clampDailyLimit(existing.dailyLimit);
  const currentRemaining = clampCredits(existing.remainingCredits, dailyLimit);
  const needsDailyReset = doesHydrogenQuotaNeedReset(existing, todayKey);
  const cycleExpired = isUserProfileCycleExpired(existing, now);

  if (needsDailyReset || cycleExpired) {
    try {
      const synced = await syncDailyHydrogenQuotaInFirestore(uid, existing, { forceCycleReset: cycleExpired });
      if (synced) {
        updatedSnapshot = {
          ...updatedSnapshot,
          ...synced
        };
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  const resolvedName = sanitizeDisplayName(
    preferredDisplayName || firebaseUser.displayName || existing.displayName,
    firebaseUser.email || existing.email
  );

  if (!alreadyLoggedSession) {
    try {
      await updateDoc(userRef, {
        visitsCount: increment(1),
        displayName: resolvedName,
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
      updatedSnapshot = {
        ...updatedSnapshot,
        visitsCount: Math.max(0, Number(updatedSnapshot.visitsCount) || 0) + 1,
        displayName: resolvedName
      };
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(sessionKey, '1');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    await recordGlobalAnalytics({ isNewUser: false, recordVisit: true });
  } else if (preferredDisplayName && resolvedName !== existing.displayName) {
    try {
      await updateDoc(userRef, {
        displayName: resolvedName,
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
      updatedSnapshot = {
        ...updatedSnapshot,
        displayName: resolvedName
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  return updatedSnapshot;
}

export function subscribeUserProfile(uid, onData, onError, onMissing) {
  if (!uid) return () => {};
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  return onSnapshot(
    userRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData?.(snapshot.data());
      } else if (!snapshot.metadata?.fromCache) {
        onMissing?.();
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError?.(wrapped);
      }
    }
  );
}

export async function syncDailyHydrogenQuotaInFirestore(uid, currentProfile, { forceCycleReset = false } = {}) {
  if (!uid || !currentProfile || currentProfile.banned === true) return null;
  const now = Date.now();
  const todayKey = getLocalCalendarDateString(new Date(now));
  const needsReset = doesHydrogenQuotaNeedReset(currentProfile, todayKey);
  const cycleExpired = forceCycleReset || isUserProfileCycleExpired(currentProfile, now);
  if (!needsReset && !cycleExpired) return null;

  const dailyLimit = clampDailyLimit(currentProfile.dailyLimit);
  const currentRemaining = clampCredits(currentProfile.remainingCredits, dailyLimit);
  const existingLastReset = typeof currentProfile.lastResetDate === 'string' ? currentProfile.lastResetDate.trim() : '';
  const hasQuotaDate = typeof currentProfile.hydrogenQuotaDate === 'string' && Boolean(currentProfile.hydrogenQuotaDate.trim());
  const existingQuotaDate = hasQuotaDate ? currentProfile.hydrogenQuotaDate.trim() : '';
  const path = `users/${uid}`;

  let updateFields;
  if (existingLastReset !== todayKey || cycleExpired) {
    const renewedCredits = Math.max(dailyLimit, currentRemaining);
    const nextCycleStart = Math.max(now, Number(currentProfile.cycleStartedAt) || 0);
    updateFields = {
      hydrogenUsedCount: 0,
      hydrogenQuotaDate: todayKey,
      remainingCredits: renewedCredits,
      lastResetDate: todayKey,
      cycleStartedAt: nextCycleStart
    };
  } else if (!hasQuotaDate || typeof currentProfile.hydrogenUsedCount !== 'number' || !Number.isFinite(currentProfile.hydrogenUsedCount)) {
    const migrated = getProfileHydrogenQuotaState(currentProfile, todayKey, dailyLimit);
    updateFields = {
      hydrogenUsedCount: migrated.used,
      hydrogenQuotaDate: todayKey,
      remainingCredits: currentRemaining,
      lastResetDate: existingLastReset || todayKey,
      cycleStartedAt: Number(currentProfile.cycleStartedAt) || now
    };
  } else if (existingQuotaDate !== todayKey) {
    updateFields = {
      hydrogenUsedCount: 0,
      hydrogenQuotaDate: todayKey,
      remainingCredits: currentRemaining,
      lastResetDate: existingLastReset || todayKey,
      cycleStartedAt: Number(currentProfile.cycleStartedAt) || now
    };
  } else {
    return null;
  }

  try {
    await updateDoc(doc(db, 'users', uid), {
      ...updateFields,
      updatedAt: serverTimestamp(),
      lastActiveAt: serverTimestamp()
    });
    return updateFields;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function consumeUserCreditInFirestore(uid, currentProfile) {
  if (!uid) return null;
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists() ? snap.data() : currentProfile;
      if (!data || data.banned === true) return null;

      const now = Date.now();
      const todayKey = getLocalCalendarDateString(new Date(now));
      const dailyLimit = clampDailyLimit(data.dailyLimit);
      const currentRemaining = clampCredits(data.remainingCredits, dailyLimit);
      const currentTotalUsed = Math.max(0, Math.floor(Number(data.totalUsed) || 0));
      const existingLastReset = typeof data.lastResetDate === 'string' ? data.lastResetDate.trim() : '';
      const hasQuotaDate = typeof data.hydrogenQuotaDate === 'string' && Boolean(data.hydrogenQuotaDate.trim());
      const existingQuotaDate = hasQuotaDate ? data.hydrogenQuotaDate.trim() : '';
      const isNewDay = hasQuotaDate ? existingQuotaDate !== todayKey : existingLastReset !== todayKey;

      if (isNewDay && existingLastReset !== todayKey) {
        const baseCredits = Math.max(dailyLimit, currentRemaining);
        const nextRemaining = Math.max(0, baseCredits - 1);
        const nextCycleStart = Math.max(now, Number(data.cycleStartedAt) || 0);
        const resultFields = {
          hydrogenUsedCount: 1,
          hydrogenQuotaDate: todayKey,
          lastResetDate: todayKey,
          cycleStartedAt: nextCycleStart,
          remainingCredits: nextRemaining,
          totalUsed: currentTotalUsed + 1
        };
        tx.update(userRef, {
          ...resultFields,
          updatedAt: serverTimestamp(),
          lastActiveAt: serverTimestamp()
        });
        return resultFields;
      }

      if (currentRemaining <= 0) return null;

      const priorUsed = typeof data.hydrogenUsedCount === 'number' && Number.isFinite(data.hydrogenUsedCount) && data.hydrogenUsedCount >= 0
        ? (isNewDay ? 0 : Math.floor(data.hydrogenUsedCount))
        : Math.max(0, dailyLimit - currentRemaining);
      const nextUsed = priorUsed + 1;
      const nextRemaining = Math.max(0, currentRemaining - 1);
      const resultFields = {
        hydrogenUsedCount: nextUsed,
        hydrogenQuotaDate: todayKey,
        lastResetDate: existingLastReset || todayKey,
        cycleStartedAt: Number(data.cycleStartedAt) || now,
        remainingCredits: nextRemaining,
        totalUsed: currentTotalUsed + 1
      };
      tx.update(userRef, {
        ...resultFields,
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
      return resultFields;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function renewExpiredCycleInFirestore(uid, currentProfile) {
  if (!uid || !currentProfile) return null;
  return syncDailyHydrogenQuotaInFirestore(uid, currentProfile);
}

export function subscribeUserChats(uid, onChats, onError) {
  if (!uid) return () => {};
  const path = `users/${uid}/chats`;
  const chatsQuery = query(
    collection(db, 'users', uid, 'chats'),
    where('ownerUid', '==', uid)
  );

  return onSnapshot(
    chatsQuery,
    (snapshot) => {
      const chats = sortChatsByRecent(
        snapshot.docs
          .map((docSnap) => normalizeChatRecord({ id: docSnap.id, ...docSnap.data() }))
          .filter(Boolean)
      );
      onChats?.(chats);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped);
      }
    }
  );
}

export async function upsertUserChatInFirestore(uid, chat, { isKnownRemote = false } = {}) {
  if (!uid || !chat) return;
  const prepared = prepareChatForFirestore(chat, uid);
  if (!prepared) return;

  const path = `users/${uid}/chats/${prepared.id}`;
  const chatRef = doc(db, 'users', uid, 'chats', prepared.id);

  if (isKnownRemote) {
    try {
      await updateDoc(chatRef, {
        title: prepared.title,
        messages: prepared.messages,
        updatedAtMs: prepared.updatedAtMs,
        updatedAt: serverTimestamp()
      });
      return;
    } catch (err) {
      const code = err?.code || '';
      const msg = err instanceof Error ? err.message : String(err || '');
      if (code !== 'not-found' && !/no document to update/i.test(msg)) {
        handleFirestoreError(err, OperationType.UPDATE, path);
        return;
      }
    }
  }

  try {
    await setDoc(chatRef, {
      ...prepared,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    const code = error?.code || '';
    if (!isKnownRemote && (code === 'permission-denied' || code === 'already-exists')) {
      try {
        await updateDoc(chatRef, {
          title: prepared.title,
          messages: prepared.messages,
          updatedAtMs: prepared.updatedAtMs,
          updatedAt: serverTimestamp()
        });
        return;
      } catch (updateErr) {
        handleFirestoreError(updateErr, OperationType.UPDATE, path);
        return;
      }
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteUserChatInFirestore(uid, chatId) {
  if (!uid || !chatId) return;
  const safeId = chatId.trim().replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
  if (!safeId) return;

  const path = `users/${uid}/chats/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'chats', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearUserChatsInFirestore(uid, chatIds = []) {
  if (!uid || !Array.isArray(chatIds) || chatIds.length === 0) return;
  const uniqueIds = Array.from(
    new Set(
      chatIds
        .filter((id) => typeof id === 'string' && id.trim())
        .map((id) => id.trim().replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128))
        .filter(Boolean)
    )
  );
  if (uniqueIds.length === 0) return;

  const path = `users/${uid}/chats`;
  try {
    for (let i = 0; i < uniqueIds.length; i += 400) {
      const chunk = uniqueIds.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const chatId of chunk) {
        batch.delete(doc(db, 'users', uid, 'chats', chatId));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function recordModelUsageInFirestore(usedTierOrModel, charCount = 0) {
  const isPlusPlus = usedTierOrModel === SUPER_MODEL_TIER || usedTierOrModel === GEMINI_HYDROGEN_MODEL_ID;
  const safeChars = Math.max(0, Math.min(200000, Math.floor(Number(charCount) || 0)));
  const quotaRef = doc(db, 'analytics', 'quota');
  const path = 'analytics/quota';

  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(quotaRef);
      const now = Date.now();
      const ptCycleStart = getPacificCycleStartMs(now);
      const ptDateKey = getPacificDateKey(now);

      if (!snap.exists()) {
        const nextDoc = {
          cycleStartedAt: ptCycleStart,
          ptDateKey,
          plusPlusUsed: isPlusPlus ? 1 : 0,
          plusUsed: isPlusPlus ? 0 : 1,
          plusPlusChars: isPlusPlus ? safeChars : 0,
          plusChars: isPlusPlus ? 0 : safeChars
        };
        tx.set(quotaRef, {
          ...nextDoc,
          updatedAt: serverTimestamp()
        });
        return nextDoc;
      }

      const data = snap.data() || {};
      const startedAt = Number(data.cycleStartedAt) || 0;
      const existingPtDateKey = typeof data.ptDateKey === 'string' ? data.ptDateKey : '';
      const needsMigrationOrReset = !existingPtDateKey
        || typeof data.plusPlusChars !== 'number'
        || typeof data.plusChars !== 'number'
        || isPacificCycleExpired(startedAt, existingPtDateKey, now);

      if (needsMigrationOrReset) {
        const nextDoc = {
          cycleStartedAt: ptCycleStart,
          ptDateKey,
          plusPlusUsed: isPlusPlus ? 1 : 0,
          plusUsed: isPlusPlus ? 0 : 1,
          plusPlusChars: isPlusPlus ? safeChars : 0,
          plusChars: isPlusPlus ? 0 : safeChars
        };
        tx.update(quotaRef, {
          ...nextDoc,
          updatedAt: serverTimestamp()
        });
        return nextDoc;
      }

      const currentPlusPlus = Math.max(0, Math.floor(Number(data.plusPlusUsed) || 0));
      const currentPlus = Math.max(0, Math.floor(Number(data.plusUsed) || 0));
      const currentPlusPlusChars = Math.max(0, Math.floor(Number(data.plusPlusChars) || 0));
      const currentPlusChars = Math.max(0, Math.floor(Number(data.plusChars) || 0));

      if (isPlusPlus) {
        tx.update(quotaRef, {
          plusPlusUsed: currentPlusPlus + 1,
          plusPlusChars: currentPlusPlusChars + safeChars,
          updatedAt: serverTimestamp()
        });
        return {
          cycleStartedAt: startedAt,
          ptDateKey: existingPtDateKey,
          plusPlusUsed: currentPlusPlus + 1,
          plusUsed: currentPlus,
          plusPlusChars: currentPlusPlusChars + safeChars,
          plusChars: currentPlusChars
        };
      }

      tx.update(quotaRef, {
        plusUsed: currentPlus + 1,
        plusChars: currentPlusChars + safeChars,
        updatedAt: serverTimestamp()
      });
      return {
        cycleStartedAt: startedAt,
        ptDateKey: existingPtDateKey,
        plusPlusUsed: currentPlusPlus,
        plusUsed: currentPlus + 1,
        plusPlusChars: currentPlusPlusChars,
        plusChars: currentPlusChars + safeChars
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeAdminDashboardData({
  onUsers,
  onAnalytics,
  onQuotaAnalytics,
  onError
}) {
  const unsubUsers = onSnapshot(
    collection(db, 'users'),
    (snapshot) => {
      const rows = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      onUsers?.(rows);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'users');
      } catch (wrapped) {
        onError?.(wrapped);
      }
    }
  );

  const unsubAnalytics = onSnapshot(
    doc(db, 'analytics', 'site'),
    (snapshot) => {
      onAnalytics?.(
        snapshot.exists()
          ? snapshot.data()
          : { totalVisits: 0, registeredUsersCount: 0 }
      );
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, 'analytics/site');
      } catch (wrapped) {
        onError?.(wrapped);
      }
    }
  );

  const unsubQuotaAnalytics = onSnapshot(
    doc(db, 'analytics', 'quota'),
    (snapshot) => {
      onQuotaAnalytics?.(
        snapshot.exists()
          ? snapshot.data()
          : {
              cycleStartedAt: getPacificCycleStartMs(),
              ptDateKey: getPacificDateKey(),
              plusPlusUsed: 0,
              plusUsed: 0,
              plusPlusChars: 0,
              plusChars: 0
            }
      );
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, 'analytics/quota');
      } catch (wrapped) {
        onError?.(wrapped);
      }
    }
  );

  return () => {
    unsubUsers();
    unsubAnalytics();
    unsubQuotaAnalytics();
  };
}

export async function fetchAdminDashboardData() {
  let usersSnap;
  try {
    usersSnap = await getDocsFromServer(collection(db, 'users'));
  } catch (serverErr) {
    const code = serverErr?.code || '';
    if (code === 'unavailable' || code === 'failed-precondition') {
      try {
        usersSnap = await getDocs(collection(db, 'users'));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'users');
      }
    } else {
      handleFirestoreError(serverErr, OperationType.LIST, 'users');
    }
  }

  let analyticsSnap;
  try {
    analyticsSnap = await getDocFromServer(doc(db, 'analytics', 'site'));
  } catch (serverErr) {
    const code = serverErr?.code || '';
    if (code === 'unavailable' || code === 'failed-precondition') {
      try {
        analyticsSnap = await getDoc(doc(db, 'analytics', 'site'));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'analytics/site');
      }
    } else {
      handleFirestoreError(serverErr, OperationType.GET, 'analytics/site');
    }
  }

  let quotaSnap;
  try {
    quotaSnap = await getDocFromServer(doc(db, 'analytics', 'quota'));
  } catch (serverErr) {
    const code = serverErr?.code || '';
    if (code === 'unavailable' || code === 'failed-precondition') {
      try {
        quotaSnap = await getDoc(doc(db, 'analytics', 'quota'));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'analytics/quota');
      }
    } else {
      handleFirestoreError(serverErr, OperationType.GET, 'analytics/quota');
    }
  }

  const users = usersSnap
    ? usersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }))
    : [];

  const analytics = analyticsSnap?.exists()
    ? analyticsSnap.data()
    : { totalVisits: 0, registeredUsersCount: 0 };

  const quotaAnalytics = quotaSnap?.exists()
    ? quotaSnap.data()
    : {
        cycleStartedAt: getPacificCycleStartMs(),
        ptDateKey: getPacificDateKey(),
        plusPlusUsed: 0,
        plusUsed: 0,
        plusPlusChars: 0,
        plusChars: 0
      };

  return { users, analytics, quotaAnalytics };
}

export async function adminUpdateUserSubscription(targetUid, { plan, dailyLimit, remainingCredits }) {
  if (!targetUid) throw new Error('Missing user ID');
  const path = `users/${targetUid}`;
  const payload = {
    plan: normalizePlan(plan),
    dailyLimit: clampDailyLimit(dailyLimit),
    remainingCredits: clampCredits(remainingCredits, clampDailyLimit(dailyLimit)),
    updatedAt: serverTimestamp()
  };

  try {
    await updateDoc(doc(db, 'users', targetUid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminUpdateUserBanStatus(targetUid, banned) {
  if (!targetUid) throw new Error('Missing user ID');
  const path = `users/${targetUid}`;
  const payload = {
    banned: Boolean(banned),
    updatedAt: serverTimestamp()
  };

  try {
    await updateDoc(doc(db, 'users', targetUid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
