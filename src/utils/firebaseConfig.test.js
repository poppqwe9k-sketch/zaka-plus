import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveFirebaseConfig, resolveFirestoreDatabaseId } from './firebaseConfig.js';

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const appletConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

test('firebase-applet-config.json targets plus-ai-d0557 with default Firestore database', () => {
  assert.equal(appletConfig.projectId, 'plus-ai-d0557');
  assert.equal(appletConfig.authDomain, 'plus-ai-d0557.firebaseapp.com');
  assert.equal(appletConfig.storageBucket, 'plus-ai-d0557.firebasestorage.app');
  assert.equal(appletConfig.messagingSenderId, '271103840085');
  assert.ok(typeof appletConfig.apiKey === 'string' && appletConfig.apiKey.startsWith('AIza'));
  assert.ok(typeof appletConfig.appId === 'string' && appletConfig.appId.includes(':271103840085:web:'));
  assert.equal(resolveFirestoreDatabaseId(appletConfig), null);
});

test('resolveFirebaseConfig applies VITE_FIREBASE_* overrides cleanly and resolves database IDs', () => {
  const overridden = resolveFirebaseConfig(appletConfig, {
    VITE_FIREBASE_PROJECT_ID: 'custom-proj',
    VITE_FIREBASE_AUTH_DOMAIN: 'custom-proj.firebaseapp.com',
    VITE_FIREBASE_DATABASE_ID: 'named-db'
  });

  assert.equal(overridden.projectId, 'custom-proj');
  assert.equal(overridden.authDomain, 'custom-proj.firebaseapp.com');
  assert.equal(resolveFirestoreDatabaseId(overridden), 'named-db');
  assert.equal(resolveFirestoreDatabaseId({ firestoreDatabaseId: '' }), null);
  assert.equal(resolveFirestoreDatabaseId({ firestoreDatabaseId: ' (default) ' }), null);
});
