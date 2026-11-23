import { GEMINI_HYDROGEN_MODEL_ID } from '../../src/shared/modelTiers.js';
import { getServerQuotaSnapshot } from '../lib/geminiKeys.js';

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

export async function handleQuota({ request, env = {} }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const snapshot = getServerQuotaSnapshot(env, GEMINI_HYDROGEN_MODEL_ID);
  return json(snapshot, 200);
}

export async function onRequestGet(context) {
  return handleQuota(context);
}
