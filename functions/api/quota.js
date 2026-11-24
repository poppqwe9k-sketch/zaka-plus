import {
  FAST_MODEL_TIER,
  GEMINI_FALLBACK_LITE_MODEL_ID,
  GEMINI_HYDROGEN_MODEL_ID,
  SUPER_MODEL_TIER
} from '../../src/shared/modelTiers.js';
import {
  DAILY_QUOTA_PER_KEY,
  PLUS_QUOTA_PER_KEY,
  getServerQuotaSnapshot
} from '../lib/geminiKeys.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function handleQuota({
  request,
  env = (typeof process !== 'undefined' && process.env ? process.env : {})
}) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const plusPlusSnapshot = getServerQuotaSnapshot(
    env,
    GEMINI_HYDROGEN_MODEL_ID,
    Date.now(),
    DAILY_QUOTA_PER_KEY
  );
  const plusSnapshot = getServerQuotaSnapshot(
    env,
    GEMINI_FALLBACK_LITE_MODEL_ID,
    Date.now(),
    PLUS_QUOTA_PER_KEY
  );

  return json({
    ...plusPlusSnapshot,
    models: {
      [SUPER_MODEL_TIER]: plusPlusSnapshot,
      [FAST_MODEL_TIER]: plusSnapshot
    }
  }, 200);
}

export async function onRequestGet(context) {
  return handleQuota(context);
}
