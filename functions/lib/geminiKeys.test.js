import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_KEY_COUNT,
  getGeminiApiKeys,
  markGeminiKeyCooldown,
  resetKeyRotationForTests,
  rotateGeminiKeys,
  runWithRotatedGeminiKeys,
  sanitizeSecretFromErrorMessage
} from './geminiKeys.js';

function buildThirteenKeyEnv(count = 13) {
  const env = {};
  for (let i = 1; i <= count; i += 1) {
    env[`GEMINI_KEY_${i}`] = `test-key-${i}`;
  }
  return env;
}

test('reads all 19 keys GEMINI_KEY_1 through GEMINI_KEY_19 and deduplicates fallback GEMINI_API_KEY', () => {
  const env = {
    ...buildThirteenKeyEnv(GEMINI_KEY_COUNT),
    GEMINI_API_KEY: 'test-key-1'
  };
  const keys = getGeminiApiKeys(env);
  assert.equal(keys.length, 19);
  assert.equal(keys[0], 'test-key-1');
  assert.equal(keys[18], 'test-key-19');
});

test('rotates starting key across all 19 secrets in round-robin order on consecutive requests', () => {
  resetKeyRotationForTests();
  const env = buildThirteenKeyEnv(GEMINI_KEY_COUNT);
  const firstKeys = [];
  for (let i = 0; i < 21; i += 1) {
    const order = rotateGeminiKeys(env);
    firstKeys.push(order[0]);
  }
  assert.deepEqual(firstKeys.slice(0, 19), [
    'test-key-1', 'test-key-2', 'test-key-3', 'test-key-4', 'test-key-5',
    'test-key-6', 'test-key-7', 'test-key-8', 'test-key-9', 'test-key-10',
    'test-key-11', 'test-key-12', 'test-key-13', 'test-key-14', 'test-key-15',
    'test-key-16', 'test-key-17', 'test-key-18', 'test-key-19'
  ]);
  assert.equal(firstKeys[19], 'test-key-1');
  assert.equal(firstKeys[20], 'test-key-2');
});

test('skips keys in 429 cooldown and automatically fails over to next healthy key', async () => {
  resetKeyRotationForTests();
  const env = buildThirteenKeyEnv();
  const calledKeys = [];

  const result = await runWithRotatedGeminiKeys(env, async ({ apiKey }) => {
    calledKeys.push(apiKey);
    if (apiKey === 'test-key-1' || apiKey === 'test-key-2') {
      const err = new Error('Quota exceeded (429)');
      err.status = 429;
      throw err;
    }
    return { used: apiKey };
  });

  assert.deepEqual(calledKeys, ['test-key-1', 'test-key-2', 'test-key-3']);
  assert.equal(result.used, 'test-key-3');

  // Next call should put healthy keys first and keep cooled-down keys 1 and 2 at the tail of the pool
  markGeminiKeyCooldown('test-key-1', { status: 429 });
  const nextOrder = rotateGeminiKeys(env);
  assert.equal(nextOrder.length, 13);
  assert.equal(nextOrder.slice(0, 11).includes('test-key-1'), false);
  assert.equal(nextOrder.slice(0, 11).includes('test-key-2'), false);
  assert.equal(nextOrder.includes('test-key-1'), true);
  assert.equal(nextOrder.includes('test-key-2'), true);
});

test('sanitizes accidental Google API keys, Bearer tokens, and internal GEMINI env names from error messages', () => {
  const sanitized = sanitizeSecretFromErrorMessage(
    'Key AIzaSyDummyKeyValue1234567890123456 with Bearer eyJhbGciOiJIUzI1NiJ9.payload failed on GEMINI_KEY_12 and GEMINI_KEYS'
  );
  assert.equal(
    sanitized,
    'Key [REDACTED_KEY] with Bearer [REDACTED_TOKEN] failed on [REDACTED_ENV] and [REDACTED_ENV]'
  );
});

test('reads GEMINI_KEYS comma-separated list alongside GEMINI_KEY_1..13 and GEMINI_API_KEY', () => {
  const keys = getGeminiApiKeys({
    GEMINI_KEY_1: 'k1',
    GEMINI_KEY_12: 'k12',
    GEMINI_KEYS: 'k-extra-1, k-extra-2 k1',
    GEMINI_API_KEY: 'k-fallback'
  });
  assert.deepEqual(keys, ['k1', 'k12', 'k-extra-1', 'k-extra-2', 'k-fallback']);
});

test('isolates Resource has been exhausted 429 cooldowns per model so fallback models keep full healthy key pool', async () => {
  resetKeyRotationForTests();
  const env = buildThirteenKeyEnv();

  await assert.rejects(
    runWithRotatedGeminiKeys(
      env,
      async () => {
        throw new Error('Resource has been exhausted (e.g. check quota).');
      },
      { model: 'gemini-4-hydrogen' }
    ),
    /Resource has been exhausted/
  );

  // All 13 keys should remain healthy and rotated for gemini-2.5-flash
  const flashKeys = rotateGeminiKeys(env, 'gemini-2.5-flash');
  assert.equal(flashKeys.length, 13);

  const tried = [];
  const res = await runWithRotatedGeminiKeys(
    env,
    async ({ apiKey }) => {
      tried.push(apiKey);
      return { ok: true, apiKey };
    },
    { model: 'gemini-2.5-flash' }
  );
  assert.equal(res.ok, true);
  assert.equal(tried.length, 1);
});

test('reads GEMINI_KEY (without number 1) alongside GEMINI_KEY_2..GEMINI_KEY_13 and ignores non-key GEMINI_MODE values', async () => {
  resetKeyRotationForTests();
  const env = {
    GEMINI_KEY: 'primary-unnumbered-key',
    GEMINI_KEY_2: 'key-2',
    GEMINI_KEY_3: 'key-3',
    GEMINI_KEY_4: 'key-4',
    GEMINI_KEY_5: 'key-5',
    GEMINI_KEY_6: 'key-6',
    GEMINI_KEY_7: 'key-7',
    GEMINI_KEY_8: 'key-8',
    GEMINI_KEY_9: 'key-9',
    GEMINI_KEY_10: 'key-10',
    GEMINI_KEY_11: 'key-11',
    GEMINI_KEY_12: 'key-12',
    GEMINI_KEY_13: 'key-13',
    GEMINI_MODE: 'plus',
    GEMINI_API_KEY: 'fallback-api-key'
  };
  const keys = getGeminiApiKeys(env);
  assert.equal(keys.length, 14);
  assert.equal(keys[0], 'primary-unnumbered-key');
  assert.equal(keys[1], 'key-2');
  assert.equal(keys[12], 'key-13');
  assert.equal(keys[13], 'fallback-api-key');
  assert.equal(keys.includes('plus'), false);

  const tried = [];
  const res = await runWithRotatedGeminiKeys(
    env,
    async ({ apiKey }) => {
      tried.push(apiKey);
      if (apiKey !== 'key-13') {
        throw new Error('Resource has been exhausted.');
      }
      return { used: apiKey };
    },
    { model: 'gemini-4-hydrogen' }
  );
  assert.equal(res.used, 'key-13');
  assert.equal(tried[0], 'primary-unnumbered-key');
  assert.equal(tried.includes('key-13'), true);
});

test('reads all 19 numbered keys GEMINI_KEY_1..GEMINI_KEY_19 plus GEMINI_KEYS', () => {
  resetKeyRotationForTests();
  const env = buildThirteenKeyEnv(GEMINI_KEY_COUNT);
  assert.equal(GEMINI_KEY_COUNT, 19);
  const keys = getGeminiApiKeys({
    ...env,
    GEMINI_KEYS: 'bulk-key-a, bulk-key-b'
  });
  assert.equal(keys.length, 21);
  assert.equal(keys[0], 'test-key-1');
  assert.equal(keys[18], 'test-key-19');
  assert.equal(keys[19], 'bulk-key-a');
  assert.equal(keys[20], 'bulk-key-b');
});

test('captures any additional GEMINI_*KEY* environment secrets cleanly without duplicates', () => {
  resetKeyRotationForTests();
  const keys = getGeminiApiKeys({
    GEMINI_KEY_1: 'k1',
    GEMINI_KEY_20: 'k20',
    GEMINI_PROJECT_KEY: 'k-proj',
    GEMINI_MODEL: 'gemini-4-hydrogen',
    GEMINI_MODE: 'plus-max'
  });
  assert.deepEqual(keys, ['k1', 'k20', 'k-proj']);
});

test('prioritizes valid AIza keys first while skipping placeholders and preserving custom fallback keys', () => {
  resetKeyRotationForTests();
  const valid1 = 'AIzaSyValidKeyOne123456789012345678';
  const valid2 = 'AIzaSyValidKeyTwo123456789012345678';
  const keys = getGeminiApiKeys({
    GEMINI_KEY: 'YOUR_API_KEY',
    GEMINI_KEY_1: 'custom-proxy-token-key',
    GEMINI_KEY_2: `"${valid1}"`,
    GEMINI_KEY_3: `Bearer ${valid2}`,
    GEMINI_KEY_COUNT: '19'
  });
  assert.deepEqual(keys, [valid1, valid2, 'custom-proxy-token-key']);
});

test('quarantines keys returning 401 ACCESS_TOKEN_TYPE_UNSUPPORTED and rotates silently without console.warn', async () => {
  resetKeyRotationForTests();
  const valid1 = 'AIzaSyRevokedKeyOne1234567890123456';
  const valid2 = 'AIzaSyWorkingKeyTwo1234567890123456';
  const env = {
    GEMINI_KEY_1: valid1,
    GEMINI_KEY_2: valid2
  };

  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await runWithRotatedGeminiKeys(env, async ({ apiKey }) => {
      if (apiKey === valid1) {
        const err = new Error('{"error":{"code":401,"message":"API key not valid. Please pass a valid API key.","status":"UNAUTHENTICATED","details":[{"reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED"}]}}');
        err.status = 401;
        throw err;
      }
      return { ok: true, apiKey };
    }, { model: 'gemini-4-hydrogen' });

    assert.equal(result.ok, true);
    assert.equal(result.apiKey, valid2);
    assert.equal(warnings.length, 0);

    const nextOrder = rotateGeminiKeys(env, 'gemini-4-hydrogen');
    assert.deepEqual(nextOrder, [valid2, valid1]);
  } finally {
    console.warn = origWarn;
  }
});

test('cleans quotes, newlines, blank lines, JSON arrays, and Bearer prefixes across GEMINI_API_KEY and GEMINI_KEYS', () => {
  resetKeyRotationForTests();
  const k1 = 'AIzaSyCleanKeyOne123456789012345678';
  const k2 = 'AIzaSyCleanKeyTwo123456789012345678';
  const k3 = 'AIzaSyCleanKeyThree1234567890123456';
  const k4 = 'AIzaSyCleanKeyFour12345678901234567';
  const keys = getGeminiApiKeys({
    GEMINI_KEY_1: `  "'${k1}'" \n `,
    GEMINI_API_KEY: `\n\n "${k2}" \n\n  \n '${k3}' ;`,
    GEMINI_KEYS: JSON.stringify([`  Bearer ${k4}  `, '', 'YOUR_API_KEY'])
  });
  assert.deepEqual(keys, [k1, k4, k2, k3]);
});

test('rotates automatically on 400 API key not valid errors and throws clear Arabic error when all keys fail auth', async () => {
  resetKeyRotationForTests();
  const bad1 = 'AIzaSyBad400KeyOne12345678901234567';
  const bad2 = 'AIzaSyBad400KeyTwo12345678901234567';
  const good = 'AIzaSyGoodKeyThree1234567890123456';

  const tried = [];
  const res = await runWithRotatedGeminiKeys(
    { GEMINI_KEY_1: bad1, GEMINI_KEY_2: bad2, GEMINI_KEY_3: good },
    async ({ apiKey }) => {
      tried.push(apiKey);
      if (apiKey !== good) {
        const err = new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}');
        err.status = 400;
        throw err;
      }
      return { ok: true, apiKey };
    },
    { model: 'gemini-3.5-flash-lite' }
  );

  assert.deepEqual(tried, [bad1, bad2, good]);
  assert.equal(res.ok, true);
  assert.equal(res.apiKey, good);

  resetKeyRotationForTests();
  await assert.rejects(
    runWithRotatedGeminiKeys(
      { GEMINI_KEY_1: bad1, GEMINI_KEY_2: bad2 },
      async () => {
        const err = new Error('API key not valid. Please pass a valid API key.');
        err.status = 400;
        throw err;
      },
      { model: 'gemini-3.5-flash-lite' }
    ),
    (err) => {
      assert.equal(err.allKeysAuthInvalid, true);
      assert.equal(err.status, 400);
      assert.match(err.message, /مفاتيح API/);
      assert.equal(/GEMINI_KEY|GEMINI_KEYS/i.test(err.message), false);
      return true;
    }
  );
});
