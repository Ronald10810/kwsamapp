import { useEffect, useMemo, useRef, useState } from 'react';
import { useGoogleMapsScript } from '../hooks/useGoogleMapsScript';

export type AddressResult = {
  streetNumber: string;
  streetName: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  formattedAddress: string;
};

type Props = {
  onSelect: (result: AddressResult) => void;
};

// Maps Google address_component types to our fields
function extractAddressComponents(
  components: google.maps.GeocoderAddressComponent[],
): Omit<AddressResult, 'latitude' | 'longitude' | 'formattedAddress'> {
  const get = (type: string, short = false) =>
    components.find((c) => c.types.includes(type))?.[short ? 'short_name' : 'long_name'] ?? '';

  return {
    streetNumber: get('street_number'),
    streetName: get('route'),
    // Google's hierarchy for SA: sublocality_level_1 or locality is the suburb/town
    suburb: get('sublocality_level_1') || get('sublocality') || get('locality'),
    city: get('locality') || get('administrative_area_level_2'),
    province: get('administrative_area_level_1'),
    postalCode: get('postal_code'),
  };
}

export function AddressSearch({ onSelect }: Props) {
  const { ready: mapsReady, loading: mapsLoading, error: mapsError } = useGoogleMapsScript();
  const [inputValue, setInputValue] = useState('');
  const [active, setActive] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState<number>(-1);
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const detailsHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapsReady) return;
    if (!autocompleteServiceRef.current) {
      autocompleteServiceRef.current = new window.google.maps.places.AutocompleteService();
    }
    if (!geocoderRef.current) {
      geocoderRef.current = new window.google.maps.Geocoder();
    }
    if (!placesServiceRef.current && detailsHostRef.current) {
      placesServiceRef.current = new window.google.maps.places.PlacesService(detailsHostRef.current);
    }
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
    }
  }, [mapsReady]);

  useEffect(() => {
    if (!mapsReady) return;
    const query = inputValue.trim();
    if (query.length < 3) {
      setPredictions([]);
      setHighlightedIdx(-1);
      return;
    }

    if (!autocompleteServiceRef.current) return;
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
    }

    const handle = window.setTimeout(() => {
      autocompleteServiceRef.current?.getPlacePredictions(
        {
          input: query,
          componentRestrictions: { country: 'za' },
          types: ['address'],
          sessionToken: sessionTokenRef.current ?? undefined,
        },
        (results, status) => {
          if (status !== window.google.maps.places.PlacesServiceStatus.OK || !results) {
            setPredictions([]);
            if (query.length >= 3 && status !== window.google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
              setLookupError('Address suggestions are unavailable right now. Please check Google Maps API restrictions.');
            }
            return;
          }
          setLookupError(null);
          setPredictions(results.slice(0, 6));
          setHighlightedIdx(-1);
        }
      );
    }, 180);

    return () => window.clearTimeout(handle);
  }, [inputValue, mapsReady]);

  const showDropdown = useMemo(
    () => active && predictions.length > 0,
    [active, predictions.length]
  );

  const applyPlaceResult = (place: google.maps.places.PlaceResult): void => {
    if (!place.address_components || !place.geometry?.location) return;

    const parts = extractAddressComponents(place.address_components);
    onSelect({
      ...parts,
      latitude: place.geometry.location.lat().toFixed(7),
      longitude: place.geometry.location.lng().toFixed(7),
      formattedAddress: place.formatted_address ?? inputValue.trim(),
    });

    setPredictions([]);
    setInputValue('');
    setHighlightedIdx(-1);
    setLookupError(null);
    sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
  };

  const choosePrediction = (prediction: google.maps.places.AutocompletePrediction): void => {
    if (!mapsReady || !placesServiceRef.current) return;

    placesServiceRef.current.getDetails(
      {
        placeId: prediction.place_id,
        fields: ['address_components', 'geometry', 'formatted_address'],
        sessionToken: sessionTokenRef.current ?? undefined,
      },
      (place, status) => {
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !place) {
          setLookupError('Could not load address details for this result. Please try another suggestion.');
          return;
        }
        applyPlaceResult(place);
      }
    );
  };

  const geocodeTypedAddress = (): void => {
    const query = inputValue.trim();
    if (!mapsReady || !query || !geocoderRef.current) return;

    geocoderRef.current.geocode(
      {
        address: query,
        componentRestrictions: { country: 'ZA' },
      },
      (results, status) => {
        if (status !== 'OK' || !results || results.length === 0) {
          setLookupError('No address match found. Please type a fuller street address.');
          return;
        }
        applyPlaceResult(results[0]);
      }
    );
  };

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) return null;

  return (
    <div className="md:col-span-3 flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">
        Search Address
        <span className="ml-1 text-slate-400 font-normal">(auto-fills fields below)</span>
      </span>

      <div className="relative">
        <input
          type="text"
          className={`w-full rounded-lg border px-3 py-2 text-sm pr-10 ${active ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-300'}`}
          placeholder="Start typing a street address in South Africa..."
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setLookupError(null);
          }}
          onFocus={() => setActive(true)}
          onBlur={() => {
            window.setTimeout(() => setActive(false), 150);
          }}
          onKeyDown={(e) => {
            if (!showDropdown && e.key === 'Enter') {
              e.preventDefault();
              geocodeTypedAddress();
              return;
            }

            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightedIdx((p) => Math.min(p + 1, predictions.length - 1));
              return;
            }

            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightedIdx((p) => Math.max(p - 1, 0));
              return;
            }

            if (e.key === 'Enter' && highlightedIdx >= 0 && predictions[highlightedIdx]) {
              e.preventDefault();
              choosePrediction(predictions[highlightedIdx]);
              return;
            }

            if (e.key === 'Escape') {
              setPredictions([]);
              setHighlightedIdx(-1);
            }
          }}
          autoComplete="off"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          📍
        </span>

        {showDropdown && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
            {predictions.map((p, idx) => (
              <button
                key={p.place_id}
                type="button"
                className={`block w-full text-left px-3 py-2 text-sm ${idx === highlightedIdx ? 'bg-slate-100' : 'bg-white hover:bg-slate-50'}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choosePrediction(p)}
              >
                {p.description}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={detailsHostRef} className="hidden" />

      {mapsLoading && (
        <p className="text-xs text-slate-400">Loading address search...</p>
      )}

      {lookupError && (
        <p className="text-xs text-amber-600">{lookupError}</p>
      )}

      {mapsError && (
        <p className="text-xs text-amber-600">Address search is unavailable right now. Please check your Google Maps API key and referrer restrictions.</p>
      )}
    </div>
  );
}
