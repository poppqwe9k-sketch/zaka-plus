import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfigFile from '../firebase-applet-config.json';

const viteEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const firebaseConfig = {
  ...firebaseConfigFile,
  ...(viteEnv.VITE_FIREBASE_API_KEY ? { apiKey: viteEnv.VITE_FIREBASE_API_KEY } : {}),
  ...(viteEnv.VITE_FIREBASE_AUTH_DOMAIN ? { authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN } : {}),
  ...(viteEnv.VITE_FIREBASE_PROJECT_ID ? { projectId: viteEnv.VITE_FIREBASE_PROJECT_ID } : {}),
  ...(viteEnv.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET } : {}),
  ...(viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID ? { messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID } : {}),
  ...(viteEnv.VITE_FIREBASE_APP_ID ? { appId: viteEnv.VITE_FIREBASE_APP_ID } : {}),
  ...(viteEnv.VITE_FIREBASE_DATABASE_ID !== undefined ? { firestoreDatabaseId: viteEnv.VITE_FIREBASE_DATABASE_ID } : {})
};

const app = initializeApp(firebaseConfig);
const databaseId = typeof firebaseConfig.firestoreDatabaseId === 'string'
  ? firebaseConfig.firestoreDatabaseId.trim()
  : '';

export const db = databaseId && databaseId !== '(default)'
  ? getFirestore(app, databaseId)
  : getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const OperationType = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write'
});

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined') {
  testConnection();
}
