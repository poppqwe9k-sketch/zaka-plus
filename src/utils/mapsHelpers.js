export const DEFAULT_MAP_CENTER = { lat: 33.3152, lng: 44.3661 };
export const DEFAULT_MAP_ZOOM = 12;
export const GMP_QUOTA_DOCS_URL =
  'https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors';
export const GMP_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

/**
 * Safely extracts a `{ lat, lng }` literal from either a Google Maps LatLng
 * instance (`.lat()`, `.lng()`) or a plain object (`{ lat, lng }`).
 */
export function toLatLngLiteral(location) {
  if (!location || typeof location !== 'object') return null;
  const rawLat = typeof location.lat === 'function' ? location.lat() : location.lat;
  const rawLng = typeof location.lng === 'function' ? location.lng() : location.lng;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Normalizes a Places API (New) `Place` object into a safe UI-ready structure
 * without mutating or fabricating place fields.
 */
export function normalizeGooglePlace(place) {
  if (!place || typeof place !== 'object') return null;
  const position = toLatLngLiteral(place.location);
  if (!position) return null;

  const displayName =
    typeof place.displayName === 'string'
      ? place.displayName.trim()
      : (typeof place.displayName?.text === 'string' ? place.displayName.text.trim() : '');

  const formattedAddress =
    typeof place.formattedAddress === 'string' ? place.formattedAddress.trim() : '';

  const rating = Number.isFinite(Number(place.rating)) && Number(place.rating) > 0
    ? Number(Number(place.rating).toFixed(1))
    : null;

  const userRatingCount = Number.isFinite(Number(place.userRatingCount)) && Number(place.userRatingCount) >= 0
    ? Math.trunc(Number(place.userRatingCount))
    : null;

  const googleMapsUri = sanitizeExternalMapsUrl(place.googleMapsURI || place.googleMapsUri || '');

  return {
    id: typeof place.id === 'string' && place.id.trim()
      ? place.id.trim()
      : `${position.lat.toFixed(6)},${position.lng.toFixed(6)}`,
    name: displayName || formattedAddress || `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`,
    address: formattedAddress,
    position,
    viewport: place.viewport || null,
    rating,
    userRatingCount,
    googleMapsUri
  };
}

export function sanitizeExternalMapsUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Detects genuine Google Maps Platform quota/auth failures without false
 * positives on empty search results or unrelated network errors.
 */
export function isMapsQuotaError(errOrPayload) {
  if (!errOrPayload) return false;

  if (typeof errOrPayload === 'object') {
    const status = Number(errOrPayload.status ?? errOrPayload.code);
    if (status === 429) return true;
    const errorStatus = errOrPayload.error?.status || errOrPayload.statusText || errOrPayload.status;
    if (errorStatus === 'RESOURCE_EXHAUSTED' || errorStatus === 'OVER_QUERY_LIMIT') {
      return true;
    }
  }

  const text = typeof errOrPayload === 'string'
    ? errOrPayload
    : [
        errOrPayload.name,
        errOrPayload.code,
        errOrPayload.status,
        errOrPayload.message,
        errOrPayload.error?.status,
        errOrPayload.error?.message
      ]
        .filter(Boolean)
        .join(' ');

  return /OverQuotaMapError|QuotaExceededError|OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED|\b429\b/i.test(text);
}

/**
 * Formats route distance and duration returned by Routes API `Route.computeRoutes`.
 */
export function formatRouteMetrics(distanceMeters, durationMillis, langCode = 'ar') {
  const isArabic = langCode === 'ar';
  const meters = Number(distanceMeters);
  const millis = Number(durationMillis);

  let distanceText = '';
  if (Number.isFinite(meters) && meters >= 0) {
    if (meters >= 1000) {
      const km = (meters / 1000).toFixed(1);
      distanceText = isArabic ? `${km} كم` : `${km} km`;
    } else {
      const m = Math.round(meters);
      distanceText = isArabic ? `${m} م` : `${m} m`;
    }
  }

  let durationText = '';
  if (Number.isFinite(millis) && millis >= 0) {
    const totalMinutes = Math.max(1, Math.round(millis / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      durationText = isArabic
        ? (minutes > 0 ? `${hours} س ${minutes} د` : `${hours} س`)
        : (minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`);
    } else {
      durationText = isArabic ? `${totalMinutes} دقيقة` : `${totalMinutes} min`;
    }
  }

  return { distanceText, durationText };
}

/**
 * Builds a concise chat prompt about a real Google Maps Place selected by the user.
 */
export function buildPlaceChatPrompt(place, langCode = 'ar') {
  if (!place || !place.name) return '';
  const details = [place.name];
  if (place.address && place.address !== place.name) {
    details.push(place.address);
  }
  const summary = details.join(' — ');
  if (langCode === 'ar') {
    return `أعطني معلومات مفيدة ونصائح عن هذا المكان من خرائط Google: ${summary}`;
  }
  return `Tell me useful details and tips about this place from Google Maps: ${summary}`;
}
