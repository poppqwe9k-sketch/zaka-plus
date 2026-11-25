import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from './quota.js';
import {
  QUOTA_CYCLE_MS,
  getServerQuotaSnapshot,
  markGeminiKeyCooldown,
  resetKeyRotationForTests
} from '../lib/geminiKeys.js';

test('GET /api/quota returns valid key count and 20 messages per key without exposing raw secrets', async () => {
  resetKeyRotationForTests();
  const env = {};
  for (let i = 1; i <= 10; i += 1) {
    env[`GEMINI_KEY_${i}`] = `AIzaSySecretKeyNumber${i}ABCDEFGHIJKLMNOPQ`;
  }

  const res = await onRequestGet({
    request: new Request('http://localhost:3000/api/quota', { method: 'GET' }),
    env
  });

  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.equal(raw.includes('AIza'), false);
  const body = JSON.parse(raw);
  assert.equal(body.validKeyCount, 10);
  assert.equal(body.quotaPerKey, 20);
  assert.equal(body.totalCapacity, 200);
  assert.equal(body.exhaustedKeyCount, 0);
  assert.equal(body.maxRemainingFromHealthyKeys, 200);
  assert.equal(body.models['plus-max'].quotaPerKey, 20);
  assert.equal(body.models['plus-max'].totalCapacity, 200);
  assert.equal(body.models['plus-fast'].quotaPerKey, 1000);
  assert.equal(body.models['plus-fast'].totalCapacity, 10000);
});

test('getServerQuotaSnapshot excludes invalid 401 keys, tracks 429 exhausted keys, and resets exhaustion at 00:00 America/Los_Angeles', () => {
  resetKeyRotationForTests();
  const t0 = Date.UTC(2026, 10, 25, 7, 30, 0); // 2026-11-24 23:30:00 PST
  const env = {
    GEMINI_KEY_1: 'k-auth-bad',
    GEMINI_KEY_2: 'k-quota-bad',
    GEMINI_KEY_3: 'k-good-1',
    GEMINI_KEY_4: 'k-good-2'
  };

  markGeminiKeyCooldown('k-auth-bad', { status: 401 }, 'gemini-4-hydrogen', t0);
  markGeminiKeyCooldown('k-quota-bad', { status: 429 }, 'gemini-4-hydrogen', t0);

  const midCycle = getServerQuotaSnapshot(env, 'gemini-4-hydrogen', t0 + 60_000);
  assert.equal(midCycle.configuredKeyCount, 4);
  assert.equal(midCycle.validKeyCount, 3);
  assert.equal(midCycle.totalCapacity, 60);
  assert.equal(midCycle.exhaustedKeyCount, 1);
  assert.equal(midCycle.healthyKeyCount, 2);
  assert.equal(midCycle.maxRemainingFromHealthyKeys, 40);

  // At 2026-11-25 08:00:00 UTC === 00:00:00 PST (11:00 AM Baghdad): 429 exhaustion resets
  const atPtMidnight = Date.UTC(2026, 10, 25, 8, 0, 0);
  const afterPtMidnight = getServerQuotaSnapshot(env, 'gemini-4-hydrogen', atPtMidnight);
  assert.equal(afterPtMidnight.exhaustedKeyCount, 0);
  assert.equal(afterPtMidnight.healthyKeyCount, 3);
  assert.equal(afterPtMidnight.maxRemainingFromHealthyKeys, 60);
  assert.equal(afterPtMidnight.ptDateKey, '2026-11-25');
});
