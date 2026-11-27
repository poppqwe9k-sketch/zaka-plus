import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiIsLoaded,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary
} from '@vis.gl/react-google-maps';
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  GMP_ATTRIBUTION_ID,
  formatRouteMetrics,
  isMapsQuotaError,
  normalizeGooglePlace,
  toLatLngLiteral
} from '../utils/mapsHelpers.js';

const MAP_LIBRARIES = ['places', 'marker', 'routes'];

function PlaceResultMarker({ place, isSelected, onSelect }) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={place.position}
        title={place.name}
        onClick={() => onSelect(place)}
      >
        <Pin
          background={isSelected ? '#e11d48' : '#2563eb'}
          borderColor={isSelected ? '#9f1239' : '#1e40af'}
          glyphColor="#ffffff"
          scale={isSelected ? 1.2 : 1}
        />
      </AdvancedMarker>
      {isSelected && marker && (
        <InfoWindow
          anchor={marker}
          maxWidth={260}
          onCloseClick={() => onSelect(null)}
        >
          <div className="maps-infowindow">
            <strong className="maps-infowindow-title">{place.name}</strong>
            {place.address && <p className="maps-infowindow-address">{place.address}</p>}
            {place.rating !== null && (
              <p className="maps-infowindow-rating">
                ★ {place.rating}
                {place.userRatingCount !== null ? ` (${place.userRatingCount})` : ''}
              </p>
            )}
            {place.googleMapsUri && (
              <a
                href={place.googleMapsUri}
                target="_blank"
                rel="noopener noreferrer"
                className="maps-infowindow-link"
              >
                Google Maps ↗
              </a>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

function MapsInnerWorkspace({
  langCode,
  t,
  onAskAboutPlace,
  onClose
}) {
  const map = useMap();
  const isLoaded = useApiIsLoaded();
  const loadingStatus = useApiLoadingStatus();
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [places, setPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routeMetrics, setRouteMetrics] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const sessionTokenRef = useRef(null);
  const polylinesRef = useRef([]);
  const debounceTimerRef = useRef(null);

  const clearPolylines = useCallback(() => {
    for (const line of polylinesRef.current) {
      try {
        line.setMap(null);
      } catch {
        // Ignore cleanup errors when map unmounts.
      }
    }
    polylinesRef.current = [];
  }, []);

  useEffect(() => () => {
    clearPolylines();
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
  }, [clearPolylines]);

  useEffect(() => {
    if (loadingStatus === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  }, [loadingStatus]);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
  }, []);

  const focusMapOnPlace = useCallback((place) => {
    if (!map || !place) return;
    if (place.viewport) {
      map.fitBounds(place.viewport);
    } else if (place.position) {
      map.panTo(place.position);
      map.setZoom(15);
    }
  }, [map]);

  // Live Autocomplete via Places API (New) AutocompleteSuggestion + SessionToken
  useEffect(() => {
    if (!placesLib) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!AutocompleteSuggestion?.fetchAutocompleteSuggestions) return;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const request = {
          input: trimmed,
          sessionToken: sessionTokenRef.current,
          language: langCode
        };
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        if (!cancelled) {
          setSuggestions(Array.isArray(res?.suggestions) ? res.suggestions.slice(0, 5) : []);
        }
      } catch (err) {
        if (!cancelled && isMapsQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      }
    }, 240);

    return () => {
      cancelled = true;
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [placesLib, query, langCode]);

  const handleSelectSuggestion = useCallback(async (suggestion) => {
    if (!placesLib || !suggestion?.placePrediction) return;
    setErrorMessage('');
    setStatusMessage('');
    setSearching(true);
    clearPolylines();
    setRouteMetrics(null);

    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: [
          'id',
          'displayName',
          'formattedAddress',
          'location',
          'viewport',
          'rating',
          'userRatingCount',
          'googleMapsURI'
        ]
      });
      const normalized = normalizeGooglePlace(place);
      resetSession();
      if (normalized) {
        setPlaces([normalized]);
        setSelectedPlace(normalized);
        setQuery(normalized.name);
        focusMapOnPlace(normalized);
      } else {
        setStatusMessage(t.mapsNoResults);
      }
    } catch (err) {
      if (isMapsQuotaError(err)) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        setErrorMessage(t.mapsQuotaError);
      } else {
        setErrorMessage(t.mapsSearchError);
      }
    } finally {
      setSearching(false);
    }
  }, [placesLib, clearPolylines, resetSession, focusMapOnPlace, t]);

  const handleSearchSubmit = useCallback(async (e) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    if (!placesLib?.Place?.searchByText) {
      setErrorMessage(t.mapsLoadingNotice);
      return;
    }

    setErrorMessage('');
    setStatusMessage('');
    setSearching(true);
    setSuggestions([]);
    clearPolylines();
    setRouteMetrics(null);

    try {
      const request = {
        textQuery: trimmed,
        fields: [
          'id',
          'displayName',
          'formattedAddress',
          'location',
          'viewport',
          'rating',
          'userRatingCount',
          'googleMapsURI'
        ],
        maxResultCount: 8,
        language: langCode
      };
      if (userLocation) {
        request.locationBias = { center: userLocation, radius: 25000 };
      }

      const response = await placesLib.Place.searchByText(request);
      const rawList = Array.isArray(response?.places) ? response.places : [];
      const normalizedList = rawList.map(normalizeGooglePlace).filter(Boolean);
      resetSession();

      setPlaces(normalizedList);
      if (normalizedList.length === 0) {
        setSelectedPlace(null);
        setStatusMessage(t.mapsNoResults);
      } else {
        const first = normalizedList[0];
        setSelectedPlace(first);
        focusMapOnPlace(first);
      }
    } catch (err) {
      if (isMapsQuotaError(err)) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        setErrorMessage(t.mapsQuotaError);
      } else {
        setErrorMessage(t.mapsSearchError);
      }
    } finally {
      setSearching(false);
    }
  }, [query, placesLib, langCode, userLocation, clearPolylines, resetSession, focusMapOnPlace, t]);

  const requestUserLocation = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        reject(new Error('Geolocation unsupported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = toLatLngLiteral({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          });
          if (coords) resolve(coords);
          else reject(new Error('Invalid coordinates'));
        },
        (geoErr) => reject(geoErr),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }, []);

  const handleMyLocation = useCallback(async () => {
    setErrorMessage('');
    setStatusMessage('');
    setLocating(true);
    try {
      const coords = await requestUserLocation();
      setUserLocation(coords);
      if (map) {
        map.panTo(coords);
        map.setZoom(14);
      }
    } catch {
      setErrorMessage(t.mapsLocationError);
    } finally {
      setLocating(false);
    }
  }, [requestUserLocation, map, t]);

  const handleComputeRoute = useCallback(async () => {
    if (!selectedPlace?.position) return;
    if (!routesLib?.Route?.computeRoutes || !map) {
      setErrorMessage(t.mapsLoadingNotice);
      return;
    }

    setErrorMessage('');
    setStatusMessage('');
    setRouting(true);
    clearPolylines();
    setRouteMetrics(null);

    try {
      let origin = userLocation;
      if (!origin) {
        origin = await requestUserLocation();
        setUserLocation(origin);
      }

      const response = await routesLib.Route.computeRoutes({
        origin,
        destination: selectedPlace.position,
        travelMode: 'DRIVING',
        fields: ['path', 'distanceMeters', 'durationMillis', 'viewport']
      });

      const primaryRoute = response?.routes?.[0];
      if (!primaryRoute) {
        setStatusMessage(t.mapsNoRouteFound);
        return;
      }

      if (typeof primaryRoute.createPolylines === 'function') {
        const lines = primaryRoute.createPolylines();
        for (const line of lines) {
          line.setOptions({
            strokeColor: '#2563eb',
            strokeWeight: 5
          });
          line.setMap(map);
        }
        polylinesRef.current = lines;
      }

      if (primaryRoute.viewport) {
        map.fitBounds(primaryRoute.viewport);
      }

      setRouteMetrics(
        formatRouteMetrics(primaryRoute.distanceMeters, primaryRoute.durationMillis, langCode)
      );
    } catch (err) {
      if (isMapsQuotaError(err)) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        setErrorMessage(t.mapsQuotaError);
      } else {
        setErrorMessage(t.mapsRouteError);
      }
    } finally {
      setRouting(false);
    }
  }, [selectedPlace, routesLib, map, userLocation, requestUserLocation, clearPolylines, langCode, t]);

  return (
    <div className="maps-workspace">
      <form className="maps-search-bar" onSubmit={handleSearchSubmit}>
        <div className="maps-search-input-wrap">
          <input
            type="search"
            className="maps-search-input"
            data-testid="maps-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.mapsSearchPlaceholder}
            aria-label={t.mapsSearchPlaceholder}
          />
          {suggestions.length > 0 && (
            <ul className="maps-suggestions-list" role="listbox" aria-label={t.mapsSuggestionsLabel}>
              {suggestions.map((suggestion, idx) => {
                const label = suggestion.placePrediction?.text?.text || '';
                if (!label) return null;
                return (
                  <li key={`${label}-${idx}`}>
                    <button
                      type="button"
                      className="maps-suggestion-item"
                      onClick={() => handleSelectSuggestion(suggestion)}
                    >
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button
          type="submit"
          className="maps-primary-btn"
          data-testid="maps-search-submit"
          disabled={searching || !query.trim()}
        >
          {searching ? t.mapsSearching : t.mapsSearchButton}
        </button>

        <button
          type="button"
          className="maps-secondary-btn"
          data-testid="maps-my-location-btn"
          onClick={handleMyLocation}
          disabled={locating}
        >
          {locating ? t.mapsLocating : t.mapsMyLocation}
        </button>
      </form>

      {errorMessage && (
        <div className="maps-feedback maps-feedback-error" role="alert">
          {errorMessage}
        </div>
      )}

      {!errorMessage && statusMessage && (
        <div className="maps-feedback" role="status">
          {statusMessage}
        </div>
      )}

      {loadingStatus === APILoadingStatus.FAILED || loadingStatus === APILoadingStatus.AUTH_FAILURE ? (
        <div className="maps-canvas-fallback" role="alert">
          {t.mapsLoadFailed}
        </div>
      ) : (
        <div className="maps-canvas-stage" data-testid="maps-canvas-stage">
          {!isLoaded && (
            <div className="maps-canvas-loading" role="status">
              {t.mapsLoadingNotice}
            </div>
          )}
          <GoogleMap
            mapId="DEMO_MAP_ID"
            defaultCenter={DEFAULT_MAP_CENTER}
            defaultZoom={DEFAULT_MAP_ZOOM}
            gestureHandling="greedy"
            internalUsageAttributionIds={[GMP_ATTRIBUTION_ID]}
            style={{ width: '100%', height: '100%' }}
          >
            {userLocation && (
              <AdvancedMarker position={userLocation} title={t.mapsMyLocation}>
                <Pin background="#16a34a" borderColor="#166534" glyphColor="#ffffff" />
              </AdvancedMarker>
            )}

            {places.map((place) => (
              <PlaceResultMarker
                key={place.id}
                place={place}
                isSelected={selectedPlace?.id === place.id}
                onSelect={(clicked) => {
                  setSelectedPlace(clicked);
                  clearPolylines();
                  setRouteMetrics(null);
                  if (clicked) focusMapOnPlace(clicked);
                }}
              />
            ))}
          </GoogleMap>
        </div>
      )}

      {selectedPlace && (
        <div className="maps-selected-card" data-testid="maps-selected-card">
          <div className="maps-selected-info">
            <div className="maps-selected-title-row">
              <strong>{selectedPlace.name}</strong>
              {selectedPlace.rating !== null && (
                <span className="maps-selected-rating">★ {selectedPlace.rating}</span>
              )}
            </div>
            {selectedPlace.address && (
              <p className="maps-selected-address">{selectedPlace.address}</p>
            )}
            {routeMetrics && (routeMetrics.distanceText || routeMetrics.durationText) && (
              <p className="maps-route-summary" data-testid="maps-route-summary">
                {t.mapsRouteSummaryLabel}:{' '}
                {[routeMetrics.distanceText, routeMetrics.durationText].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>

          <div className="maps-selected-actions">
            <button
              type="button"
              className="maps-secondary-btn"
              data-testid="maps-directions-btn"
              onClick={handleComputeRoute}
              disabled={routing}
            >
              {routing ? t.mapsCalculatingRoute : t.mapsDirectionsButton}
            </button>

            {selectedPlace.googleMapsUri && (
              <a
                href={selectedPlace.googleMapsUri}
                target="_blank"
                rel="noopener noreferrer"
                className="maps-secondary-btn maps-link-btn"
              >
                {t.mapsOpenInGoogleMaps}
              </a>
            )}

            <button
              type="button"
              className="maps-primary-btn"
              data-testid="maps-ask-ai-btn"
              onClick={() => {
                onAskAboutPlace(selectedPlace);
                onClose();
              }}
            >
              {t.mapsAskAiButton}
            </button>
          </div>
        </div>
      )}

      {places.length > 1 && (
        <div className="maps-results-strip" role="list">
          {places.map((place) => (
            <button
              key={place.id}
              type="button"
              role="listitem"
              className={`maps-result-chip ${selectedPlace?.id === place.id ? 'maps-result-chip-active' : ''}`}
              onClick={() => {
                setSelectedPlace(place);
                clearPolylines();
                setRouteMetrics(null);
                focusMapOnPlace(place);
              }}
            >
              <span>{place.name}</span>
              {place.rating !== null && <small>★ {place.rating}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GoogleMapsModal({
  open,
  onClose,
  apiKey,
  configLoading,
  langCode,
  dir,
  t,
  onAskAboutPlace
}) {
  if (!open) return null;

  return (
    <div
      className="settings-overlay maps-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="maps-modal-title"
      dir={dir}
      data-testid="google-maps-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-dialog maps-dialog">
        <div className="settings-header maps-header">
          <div className="maps-title-wrap">
            <h2 id="maps-modal-title">{t.mapsModalTitle}</h2>
            <p className="maps-subtitle">{t.mapsModalSubtitle}</p>
          </div>
          <button
            type="button"
            className="settings-close"
            data-testid="maps-modal-close"
            onClick={onClose}
            aria-label={t.authCloseAria}
          >
            ×
          </button>
        </div>

        <div className="settings-body maps-body">
          {configLoading ? (
            <div className="maps-canvas-fallback" role="status">
              {t.mapsLoadingNotice}
            </div>
          ) : !apiKey ? (
            <div className="maps-canvas-fallback" role="alert">
              {t.mapsMissingKeyNotice}
            </div>
          ) : (
            <APIProvider
              apiKey={apiKey}
              language={langCode || 'ar'}
              libraries={MAP_LIBRARIES}
            >
              <MapsInnerWorkspace
                langCode={langCode || 'ar'}
                t={t}
                onAskAboutPlace={onAskAboutPlace}
                onClose={onClose}
              />
            </APIProvider>
          )}
        </div>
      </div>
    </div>
  );
}
