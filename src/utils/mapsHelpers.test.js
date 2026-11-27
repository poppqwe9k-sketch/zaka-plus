import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GMP_ATTRIBUTION_ID,
  GMP_QUOTA_DOCS_URL,
  buildPlaceChatPrompt,
  formatRouteMetrics,
  isMapsQuotaError,
  normalizeGooglePlace,
  sanitizeExternalMapsUrl,
  toLatLngLiteral
} from './mapsHelpers.js';

test('exposes mandatory AI Studio attribution ID and docs link with utm_campaign', () => {
  assert.equal(GMP_ATTRIBUTION_ID, 'gmp_mcp_codeassist_v1_aistudio');
  assert.ok(GMP_QUOTA_DOCS_URL.includes('utm_campaign=gmp_mcp_codeassist_v1_aistudio'));
});

test('toLatLngLiteral normalizes both POJO literals and Google Maps LatLng methods', () => {
  assert.deepEqual(toLatLngLiteral({ lat: 33.3152, lng: 44.3661 }), { lat: 33.3152, lng: 44.3661 });
  assert.deepEqual(
    toLatLngLiteral({ lat: () => 25.2048, lng: () => 55.2708 }),
    { lat: 25.2048, lng: 55.2708 }
  );
  assert.equal(toLatLngLiteral({ lat: 999, lng: 10 }), null);
  assert.equal(toLatLngLiteral(null), null);
});

test('normalizeGooglePlace transforms live Places API (New) results cleanly', () => {
  const normalized = normalizeGooglePlace({
    id: 'ChIJ123',
    displayName: 'Baghdad Mall',
    formattedAddress: 'Al-Harthiya, Baghdad, Iraq',
    location: { lat: () => 33.3095, lng: () => 44.3612 },
    rating: 4.56,
    userRatingCount: 1200,
    googleMapsURI: 'https://maps.google.com/?cid=123'
  });

  assert.deepEqual(normalized, {
    id: 'ChIJ123',
    name: 'Baghdad Mall',
    address: 'Al-Harthiya, Baghdad, Iraq',
    position: { lat: 33.3095, lng: 44.3612 },
    viewport: null,
    rating: 4.6,
    userRatingCount: 1200,
    googleMapsUri: 'https://maps.google.com/?cid=123'
  });
  assert.equal(normalizeGooglePlace({ displayName: 'Missing location' }), null);
});

test('sanitizeExternalMapsUrl allows only http(s) URLs', () => {
  assert.equal(sanitizeExternalMapsUrl('https://maps.google.com/?q=baghdad'), 'https://maps.google.com/?q=baghdad');
  assert.equal(sanitizeExternalMapsUrl('javascript:alert(1)'), '');
});

test('isMapsQuotaError flags genuine quota errors without false positives on empty results', () => {
  assert.equal(isMapsQuotaError({ status: 429 }), true);
  assert.equal(isMapsQuotaError({ error: { status: 'RESOURCE_EXHAUSTED' } }), true);
  assert.equal(isMapsQuotaError({ status: 'OVER_QUERY_LIMIT' }), true);
  assert.equal(isMapsQuotaError(new Error('OverQuotaMapError: daily quota exceeded')), true);
  assert.equal(isMapsQuotaError('QuotaExceededError'), true);

  assert.equal(isMapsQuotaError({ status: 'ZERO_RESULTS' }), false);
  assert.equal(isMapsQuotaError(new Error('No places found for query')), false);
  assert.equal(isMapsQuotaError({ status: 404 }), false);
  assert.equal(isMapsQuotaError(null), false);
});

test('formatRouteMetrics formats meters/km and minutes/hours in Arabic and English', () => {
  assert.deepEqual(formatRouteMetrics(850, 180000, 'ar'), {
    distanceText: '850 م',
    durationText: '3 دقيقة'
  });
  assert.deepEqual(formatRouteMetrics(15400, 4500000, 'en'), {
    distanceText: '15.4 km',
    durationText: '1h 15m'
  });
});

test('buildPlaceChatPrompt creates contextual Arabic and English prompts', () => {
  const place = { name: 'Al-Mutanabbi Street', address: 'Baghdad, Iraq' };
  assert.ok(buildPlaceChatPrompt(place, 'ar').includes('Al-Mutanabbi Street — Baghdad, Iraq'));
  assert.ok(buildPlaceChatPrompt(place, 'en').includes('Al-Mutanabbi Street — Baghdad, Iraq'));
  assert.equal(buildPlaceChatPrompt(null, 'ar'), '');
});
