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

export function resolveMapsApiKey(env = {}) {
  const raw = env?.VITE_GOOGLE_MAPS_API_KEY || env?.GOOGLE_MAPS_API_KEY || '';
  return typeof raw === 'string' ? raw.trim() : '';
}

export async function handleMapsConfig({
  request,
  env = (typeof process !== 'undefined' && process.env ? process.env : {})
}) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const apiKey = resolveMapsApiKey(env);
  return json({
    configured: Boolean(apiKey),
    apiKey
  }, 200);
}

export async function onRequestGet(context) {
  return handleMapsConfig(context);
}
