export function resolveFirebaseConfig(baseConfig = {}, env = {}) {
  const safeBase = baseConfig && typeof baseConfig === 'object' ? baseConfig : {};
  const safeEnv = env && typeof env === 'object' ? env : {};

  return {
    ...safeBase,
    ...(safeEnv.VITE_FIREBASE_API_KEY ? { apiKey: safeEnv.VITE_FIREBASE_API_KEY } : {}),
    ...(safeEnv.VITE_FIREBASE_AUTH_DOMAIN ? { authDomain: safeEnv.VITE_FIREBASE_AUTH_DOMAIN } : {}),
    ...(safeEnv.VITE_FIREBASE_PROJECT_ID ? { projectId: safeEnv.VITE_FIREBASE_PROJECT_ID } : {}),
    ...(safeEnv.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: safeEnv.VITE_FIREBASE_STORAGE_BUCKET } : {}),
    ...(safeEnv.VITE_FIREBASE_MESSAGING_SENDER_ID
      ? { messagingSenderId: safeEnv.VITE_FIREBASE_MESSAGING_SENDER_ID }
      : {}),
    ...(safeEnv.VITE_FIREBASE_APP_ID ? { appId: safeEnv.VITE_FIREBASE_APP_ID } : {}),
    ...(safeEnv.VITE_FIREBASE_MEASUREMENT_ID
      ? { measurementId: safeEnv.VITE_FIREBASE_MEASUREMENT_ID }
      : {}),
    ...(safeEnv.VITE_FIREBASE_DATABASE_ID !== undefined
      ? { firestoreDatabaseId: safeEnv.VITE_FIREBASE_DATABASE_ID }
      : {})
  };
}

export function resolveFirestoreDatabaseId(config = {}) {
  const raw = typeof config?.firestoreDatabaseId === 'string'
    ? config.firestoreDatabaseId.trim()
    : '';
  if (!raw || raw === '(default)') {
    return null;
  }
  return raw;
}
