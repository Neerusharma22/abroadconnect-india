/// <reference types="google.maps" />
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Building2, ExternalLink, MapPin, Search } from 'lucide-react';
import { safeExternalUrl } from '../api';
import type { Country } from '../types';

interface GlobalCampusMapProps {
  countries: Country[];
}

interface PlacePinItem {
  id: string;
  name: string;
  address: string;
  position: google.maps.LatLngLiteral;
  rating?: number;
  websiteURI?: string;
}

const DESTINATION_VIEWPORTS: Record<string, { center: google.maps.LatLngLiteral; zoom: number; label: string }> = {
  germany: { center: { lat: 48.1351, lng: 11.582 }, zoom: 11, label: 'Munich, Germany' },
  'united-kingdom': { center: { lat: 51.5072, lng: -0.1276 }, zoom: 11, label: 'London, UK' },
  canada: { center: { lat: 43.6532, lng: -79.3832 }, zoom: 11, label: 'Toronto, Canada' },
  'united-states': { center: { lat: 42.3601, lng: -71.0589 }, zoom: 11, label: 'Boston, USA' },
  australia: { center: { lat: -33.8688, lng: 151.2093 }, zoom: 11, label: 'Sydney, Australia' },
  ireland: { center: { lat: 53.3498, lng: -6.2603 }, zoom: 11, label: 'Dublin, Ireland' },
  singapore: { center: { lat: 1.3521, lng: 103.8198 }, zoom: 12, label: 'Singapore' },
  japan: { center: { lat: 35.6762, lng: 139.6503 }, zoom: 11, label: 'Tokyo, Japan' },
};

function notifyIfQuotaError(err: unknown) {
  const msg = String(err instanceof Error ? err.message : err);
  if (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('Quota') ||
    msg.includes('429')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

const PlaceMarkerWithInfo: React.FC<{ item: PlacePinItem; selected: boolean; onSelect: () => void }> = ({
  item,
  selected,
  onSelect,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const safeWeb = safeExternalUrl(item.websiteURI);

  return (
    <>
      <AdvancedMarker ref={markerRef} position={item.position} onClick={onSelect} title={item.name}>
        <Pin background={selected ? '#142B5F' : '#2563EB'} borderColor="#ffffff" glyphColor="#ffffff" />
      </AdvancedMarker>
      {selected && marker && (
        <InfoWindow anchor={marker} maxWidth={260} onCloseClick={onSelect}>
          <div className="p-1 text-slate-900 space-y-1">
            <p className="font-semibold text-xs">{item.name}</p>
            <p className="text-[11px] text-slate-600">{item.address}</p>
            {typeof item.rating === 'number' && (
              <p className="text-[11px] font-medium text-amber-700">Rating: {item.rating.toFixed(1)} / 5</p>
            )}
            {safeWeb && (
              <a
                href={safeWeb}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline pt-1"
              >
                <span>Official Website</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
};

const CampusSearchOverlay: React.FC<{
  selectedCountry: string;
  onCountryChange: (slug: string) => void;
  countries: Country[];
  onPlacesFound: (items: PlacePinItem[], centerTo?: google.maps.LatLngLiteral) => void;
}> = ({ selectedCountry, onCountryChange, countries, onPlacesFound }) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('university campus');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  useEffect(() => {
    if (!placesLib || searchInput.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken();
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: searchInput,
        sessionToken: sessionTokenRef.current || undefined,
      })
        .then((res: { suggestions: google.maps.places.AutocompleteSuggestion[] }) => {
          if (!cancelled) {
            setSuggestions(res.suggestions || []);
          }
        })
        .catch((err: unknown) => {
          notifyIfQuotaError(err);
        });
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [placesLib, searchInput]);

  const handleSelectSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['id', 'displayName', 'formattedAddress', 'location', 'viewport', 'websiteURI', 'rating'],
        });
        sessionTokenRef.current = null;
        setSuggestions([]);
        setSearchInput(place.displayName || '');

        if (place.location) {
          const pos = { lat: place.location.lat(), lng: place.location.lng() };
          if (map) {
            if (place.viewport) map.fitBounds(place.viewport);
            else {
              map.panTo(pos);
              map.setZoom(14);
            }
          }
          onPlacesFound(
            [
              {
                id: place.id || `${pos.lat},${pos.lng}`,
                name: place.displayName || 'Selected Place',
                address: place.formattedAddress || '',
                position: pos,
                rating: place.rating ?? undefined,
                websiteURI: place.websiteURI ?? undefined,
              },
            ],
            pos
          );
        }
      } catch (err) {
        notifyIfQuotaError(err);
      }
    },
    [placesLib, map, onPlacesFound]
  );

  const runTextSearch = useCallback(
    async (queryText: string) => {
      if (!placesLib) return;
      setSearching(true);
      const viewport = DESTINATION_VIEWPORTS[selectedCountry] || DESTINATION_VIEWPORTS.germany;
      try {
        const { places } = await placesLib.Place.searchByText({
          textQuery: `${queryText} in ${viewport.label}`,
          fields: ['id', 'displayName', 'formattedAddress', 'location', 'rating', 'websiteURI'],
          maxResultCount: 8,
          locationBias: viewport.center,
        });

        const mapped: PlacePinItem[] = (places || [])
          .filter((p: google.maps.places.Place) => Boolean(p.location))
          .map((p: google.maps.places.Place) => ({
            id: p.id || Math.random().toString(36).slice(2),
            name: p.displayName || 'Place',
            address: p.formattedAddress || '',
            position: { lat: p.location!.lat(), lng: p.location!.lng() },
            rating: p.rating ?? undefined,
            websiteURI: p.websiteURI ?? undefined,
          }));

        if (map && mapped[0]) {
          map.panTo(mapped[0].position);
          map.setZoom(12);
        }
        onPlacesFound(mapped);
      } catch (err) {
        notifyIfQuotaError(err);
      } finally {
        setSearching(false);
      }
    },
    [placesLib, selectedCountry, map, onPlacesFound]
  );

  useEffect(() => {
    if (placesLib) {
      void runTextSearch(categoryQuery);
    }
  }, [placesLib, selectedCountry, categoryQuery, runTextSearch]);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <select
          aria-label="Destination country hub"
          value={selectedCountry}
          onChange={(e) => {
            const slug = e.target.value;
            onCountryChange(slug);
            const vp = DESTINATION_VIEWPORTS[slug] || DESTINATION_VIEWPORTS.germany;
            if (map) {
              map.panTo(vp.center);
              map.setZoom(vp.zoom);
            }
          }}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-900 dark:text-white"
        >
          {countries.slice(0, 10).map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          {[
            ['university campus', 'Universities'],
            ['indian consulate embassy', 'Consulates'],
            ['student library', 'Student Hubs'],
          ].map(([qVal, label]) => (
            <button
              key={qVal}
              type="button"
              onClick={() => setCategoryQuery(qVal)}
              className={`flex-1 rounded-lg px-2.5 py-2 text-xs font-semibold border transition-colors ${
                categoryQuery === qVal
                  ? 'bg-[#142B5F] text-white border-[#142B5F] dark:bg-[#2563EB] dark:border-[#2563EB]'
                  : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={searching ? 'Searching Places...' : 'Search address or university...'}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white"
          />
          {suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-30 max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {suggestions.map((s, idx) => (
                <li key={idx}>
                  <button
                    type="button"
                    onClick={() => void handleSelectSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {s.placePrediction?.text.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export const GlobalCampusMap: React.FC<GlobalCampusMapProps> = ({ countries }) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const [selectedCountry, setSelectedCountry] = useState('germany');
  const [places, setPlaces] = useState<PlacePinItem[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  const initialViewport = DESTINATION_VIEWPORTS[selectedCountry] || DESTINATION_VIEWPORTS.germany;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white flex items-center gap-2">
          <MapPin className="w-6 h-6 text-[#2563EB]" />
          <span>Campus, Consulate & City Explorer</span>
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Locate official university campuses, Indian consulates, and student hubs using live Google Maps Platform data.
        </p>
      </div>

      {!apiKey ? (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-6 text-xs text-amber-900 dark:text-amber-200 space-y-2">
          <p className="font-semibold">Google Maps Platform key pending runtime injection</p>
          <p>
            Once the provisioned <code>VITE_GOOGLE_MAPS_API_KEY</code> environment variable is active in the runtime container, the interactive campus locator and Places API (New) search will render automatically.
          </p>
        </div>
      ) : (
        <APIProvider
          apiKey={apiKey}
          libraries={['places', 'marker']}
          language="en"
          region="IN"
        >
          <CampusSearchOverlay
            selectedCountry={selectedCountry}
            onCountryChange={(slug) => {
              setSelectedCountry(slug);
              setSelectedPlaceId(null);
            }}
            countries={countries}
            onPlacesFound={(items) => {
              setPlaces(items);
              setSelectedPlaceId(items[0]?.id || null);
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 h-[520px] w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
              <GoogleMap
                mapId="DEMO_MAP_ID"
                defaultCenter={initialViewport.center}
                defaultZoom={initialViewport.zoom}
                gestureHandling="greedy"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                style={{ width: '100%', height: '100%' }}
              >
                {places.map((item) => (
                  <PlaceMarkerWithInfo
                    key={item.id}
                    item={item}
                    selected={selectedPlaceId === item.id}
                    onSelect={() => setSelectedPlaceId((prev) => (prev === item.id ? null : item.id))}
                  />
                ))}
              </GoogleMap>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 max-h-[520px] overflow-y-auto space-y-2">
              <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white flex items-center gap-2 mb-2">
                <Building2 className="w-4 h-4 text-[#2563EB]" />
                <span>Live Places Results ({places.length})</span>
              </h2>
              {places.length === 0 ? (
                <p className="text-xs text-slate-500">Select a category or search a campus above to load live locations.</p>
              ) : (
                places.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlaceId(p.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selectedPlaceId === p.id
                        ? 'border-[#2563EB] bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <p className="text-xs font-semibold text-[#0F172A] dark:text-white">{p.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{p.address}</p>
                    {typeof p.rating === 'number' && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        Rating: {p.rating.toFixed(1)} / 5
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </APIProvider>
      )}
    </div>
  );
};
