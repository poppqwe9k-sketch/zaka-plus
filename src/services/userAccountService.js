import {
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
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
    if (code === 'not-found' || /no document to update/i.test(msg)) {
      try {
        await setDoc(analyticsRef, {
          totalVisits: visitDelta,
          registeredUsersCount: userDelta,
          updatedAt: serverTimestamp()
        });
      } catch (createErr) {
        handleFirestoreError(createErr, OperationType.CREATE, 'analytics/site');
      }
      return;
    }
    handleFirestoreError(err, OperationType.UPDATE, 'analytics/site');
  }
}

export async function syncUserProfileOnSignIn(firebaseUser) {
  if (!firebaseUser?.uid) return null;
  const uid = firebaseUser.uid;
  const userRef = doc(db, 'users', uid);
  const path = `users/${uid}`;

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
      displayName: firebaseUser.displayName || '',
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
  const dailyLimit = clampDailyLimit(existing.dailyLimit);
  const currentRemaining = clampCredits(existing.remainingCredits, dailyLimit);

  if (isUserProfileCycleExpired(existing, now)) {
    const renewedCredits = Math.max(dailyLimit, currentRemaining);
    try {
      await updateDoc(userRef, {
        remainingCredits: renewedCredits,
        cycleStartedAt: now,
        lastResetDate: todayKey,
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  if (!alreadyLoggedSession) {
    const nextDisplayName = sanitizeDisplayName(
      firebaseUser.displayName || existing.displayName,
      firebaseUser.email || existing.email
    );
    try {
      await updateDoc(userRef, {
        visitsCount: increment(1),
        displayName: nextDisplayName,
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(sessionKey, '1');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    await recordGlobalAnalytics({ isNewUser: false, recordVisit: true });
  }

  return existing;
}

export function subscribeUserProfile(uid, onData, onError) {
  if (!uid) return () => {};
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  return onSnapshot(
    userRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData?.(snapshot.data());
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

export async function consumeUserCreditInFirestore(uid, currentProfile) {
  if (!uid || !currentProfile) return;
  const currentRemaining = clampCredits(currentProfile.remainingCredits, 0);
  if (currentRemaining <= 0) return;

  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      remainingCredits: currentRemaining - 1,
      totalUsed: Math.max(0, Math.floor(Number(currentProfile.totalUsed) || 0)) + 1,
      updatedAt: serverTimestamp(),
      lastActiveAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function renewExpiredCycleInFirestore(uid, currentProfile) {
  if (!uid || !currentProfile) return;
  const now = Date.now();
  if (!isUserProfileCycleExpired(currentProfile, now)) return;

  const dailyLimit = clampDailyLimit(currentProfile.dailyLimit);
  const currentRemaining = clampCredits(currentProfile.remainingCredits, dailyLimit);
  const renewedCredits = Math.max(dailyLimit, currentRemaining);
  const todayKey = getLocalDateKey(new Date(now));
  const path = `users/${uid}`;

  try {
    await updateDoc(doc(db, 'users', uid), {
      remainingCredits: renewedCredits,
      cycleStartedAt: now,
      lastResetDate: todayKey,
      updatedAt: serverTimestamp(),
      lastActiveAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeAdminDashboardData({ onUsers, onAnalytics, onError }) {
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

  return () => {
    unsubUsers();
    unsubAnalytics();
  };
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
