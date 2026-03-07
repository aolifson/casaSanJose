import { useState, useEffect, useCallback } from 'react';
import type {
  AppMode,
  GeocodedAddress,
  RouteResult,
  VolunteerEntry,
  VolunteerRouteResult,
} from './types';
import { loadMapsApi, geocodeAddress } from './utils/maps';
import { computeVolunteerRoute, computeMultiVolunteerRoutes } from './utils/routing';
import { calcEvenSplit } from './components/VolunteerList';

import TabNav from './components/TabNav';
import ApiKeyInput from './components/ApiKeyInput';
import AddressInput from './components/AddressInput';
import AddressList from './components/AddressList';
import FileUpload from './components/FileUpload';
import VolunteerList from './components/VolunteerList';
import ImageAddressInput from './components/ImageAddressInput';
import RouteResults from './components/RouteResults';
import MapView from './components/MapView';

// ─── Default non-profit address ───────────────────────────────────────────────
const DEFAULT_NONPROFIT: GeocodedAddress = {
  raw: '9XR6+VJ Pittsburgh, Pennsylvania',
  formatted: '9XR6+VJ Pittsburgh, Pennsylvania',
  lat: 40.3936,
  lng: -79.9939,
};

// ─── localStorage helpers ──────────────────────────────────────────────────────
function loadFromStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing — ignore
  }
}

export default function App() {
  // ── API Keys ───────────────────────────────────────────────────────────────
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    envKey || loadFromStorage<string>('csj_api_key') || ''
  );
  const [anthropicApiKey, setAnthropicApiKey] = useState<string>(
    loadFromStorage<string>('csj_anthropic_key') || ''
  );
  const [showAnthropicKeyPrompt, setShowAnthropicKeyPrompt] = useState(false);

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState('');

  // ── App State ──────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<AppMode>('coordinator');
  const [nonprofitAddress, setNonprofitAddress] = useState<GeocodedAddress>(
    loadFromStorage<GeocodedAddress>('csj_nonprofit') ?? DEFAULT_NONPROFIT
  );

  // Coordinator state
  const [deliveryPool, setDeliveryPool] = useState<GeocodedAddress[]>([]);
  const [numVolunteers, setNumVolunteers] = useState(2);
  const [volunteers, setVolunteers] = useState<VolunteerEntry[]>([]);
  const [coordResults, setCoordResults] = useState<VolunteerRouteResult[] | null>(null);

  // Volunteer state
  const [volunteerHome, setVolunteerHome] = useState<GeocodedAddress | null>(
    loadFromStorage<GeocodedAddress>('csj_vol_home')
  );
  const [assignedDeliveries, setAssignedDeliveries] = useState<GeocodedAddress[]>([]);
  const [volResult, setVolResult] = useState<RouteResult | null>(null);

  // Shared
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState('');

  // ── Load Maps SDK ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapsApiKey) return;
    loadMapsApi(mapsApiKey)
      .then(() => setMapsReady(true))
      .catch((e) => setMapsError(e instanceof Error ? e.message : 'Failed to load Google Maps.'));
  }, [mapsApiKey]);

  // ── Auto-geocode nonprofit if it only has placeholder coordinates ──────────
  useEffect(() => {
    if (!mapsReady || nonprofitAddress.placeId) return;
    geocodeAddress(nonprofitAddress.raw || nonprofitAddress.formatted)
      .then((geocoded) => {
        setNonprofitAddress(geocoded);
        saveToStorage('csj_nonprofit', geocoded);
      })
      .catch(() => {}); // user can correct via the address input
  }, [mapsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist addresses ──────────────────────────────────────────────────────
  const handleMapsApiKey = (key: string) => {
    setMapsApiKey(key);
    saveToStorage('csj_api_key', key);
  };

  const handleAnthropicApiKey = (key: string) => {
    setAnthropicApiKey(key);
    saveToStorage('csj_anthropic_key', key);
    setShowAnthropicKeyPrompt(false);
  };

  const handleNonprofitChange = (addr: GeocodedAddress | null) => {
    const next = addr ?? DEFAULT_NONPROFIT;
    setNonprofitAddress(next);
    saveToStorage('csj_nonprofit', next);
  };

  const handleVolunteerHomeChange = useCallback((addr: GeocodedAddress | null) => {
    setVolunteerHome(addr);
    saveToStorage('csj_vol_home', addr);
  }, []);

  // ── Mode switch resets results ─────────────────────────────────────────────
  const handleModeChange = (m: AppMode) => {
    setMode(m);
    setError('');
    setCoordResults(null);
    setVolResult(null);
    setShowAnthropicKeyPrompt(false);
  };

  // ── Coordinator: generate all routes (even-split) ─────────────────────────
  const handleGenerateRoutes = async () => {
    setError('');
    if (deliveryPool.length === 0) { setError('Upload and geocode a delivery address file first.'); return; }
    if (numVolunteers < 1) { setError('Set at least 1 volunteer.'); return; }
    if (!nonprofitAddress.placeId) { setError('The pickup address is still being verified — please wait a moment or re-enter it.'); return; }

    // Apply even-split numStops to each volunteer before routing
    const splits = calcEvenSplit(deliveryPool.length, numVolunteers);
    const volunteersWithStops = volunteers.slice(0, numVolunteers).map((v, i) => ({
      ...v,
      numStops: splits[i],
    }));

    setComputing(true);
    try {
      const results = await computeMultiVolunteerRoutes(volunteersWithStops, nonprofitAddress, deliveryPool);
      setCoordResults(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate routes. Please try again.');
    } finally {
      setComputing(false);
    }
  };

  // ── Volunteer: compute my route ────────────────────────────────────────────
  const handleComputeVolRoute = async () => {
    setError('');
    if (!volunteerHome) { setError('Please enter your home address.'); return; }
    if (assignedDeliveries.length === 0) { setError('Please add your assigned delivery addresses.'); return; }
    if (!nonprofitAddress.placeId) { setError('The pickup address is still being verified — please wait a moment or re-enter it.'); return; }

    setComputing(true);
    try {
      const result = await computeVolunteerRoute(volunteerHome, nonprofitAddress, assignedDeliveries);
      setVolResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute route. Please try again.');
    } finally {
      setComputing(false);
    }
  };

  const handleDeliveriesFromImage = (extracted: GeocodedAddress[]) => {
    // Deduplicate against existing addresses
    const existing = new Set(assignedDeliveries.map((a) => a.placeId ?? a.formatted));
    const newOnes = extracted.filter((a) => !existing.has(a.placeId ?? a.formatted));
    setAssignedDeliveries((prev) => [...prev, ...newOnes]);
  };

  // ── Reset ──────────────────────────────────────────────────────────────────
  const resetCoord = () => { setCoordResults(null); setError(''); };
  const resetVol = () => { setVolResult(null); setError(''); };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!mapsApiKey) return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <ApiKeyInput
        onKeySubmit={handleMapsApiKey}
        title="Google Maps API Key Required"
        description="This app uses Google Maps for routing and address lookup."
        linkText="Get a free Google Maps API key →"
        linkHref="https://developers.google.com/maps/get-started"
        placeholder="AIza..."
      />
    </div>
  );

  if (mapsError) return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-md p-6 text-center">
        <p className="text-red-600 font-medium">{mapsError}</p>
        <button className="btn-secondary mt-4" onClick={() => { setMapsApiKey(''); setMapsError(''); }}>
          Try a different API key
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-4 py-4 shadow-sm">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-xl">🏠</div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Casa San Jose</h1>
              <p className="text-xs text-gray-500">Delivery Route Planner</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">
        {/* Tab nav */}
        <TabNav activeMode={mode} onChange={handleModeChange} />

        {/* Non-profit address (shared) */}
        {mapsReady && (
          <div className="card p-4">
            <AddressInput
              label="Non-profit pickup address"
              placeholder="Casa San Jose address..."
              value={nonprofitAddress}
              onChange={handleNonprofitChange}
            />
          </div>
        )}

        {/* Loading spinner for Maps SDK */}
        {!mapsReady && (
          <div className="flex items-center justify-center gap-3 py-8 text-gray-400">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-amber-500" />
            <span className="text-sm">Loading Google Maps...</span>
          </div>
        )}

        {mapsReady && (
          <>
            {/* ── COORDINATOR MODE ── */}
            {mode === 'coordinator' && !coordResults && (
              <div className="space-y-4">
                {/* Step 1: upload delivery pool */}
                <div className="card p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Step 1 — Delivery Addresses</p>
                  <FileUpload onAddressesLoaded={setDeliveryPool} />
                  {deliveryPool.length > 0 && (
                    <p className="mt-3 text-xs font-medium text-green-700">
                      ✓ {deliveryPool.length} delivery addresses ready
                    </p>
                  )}
                </div>

                {/* Step 2: volunteers */}
                <div className="card p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Step 2 — Volunteers</p>
                  <VolunteerList
                    numVolunteers={numVolunteers}
                    onNumVolunteersChange={setNumVolunteers}
                    volunteers={volunteers}
                    onChange={setVolunteers}
                    totalPoolSize={deliveryPool.length}
                  />
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
                )}

                <button
                  type="button"
                  onClick={handleGenerateRoutes}
                  disabled={computing || deliveryPool.length === 0 || numVolunteers < 1}
                  className="btn-primary w-full py-4 text-base"
                >
                  {computing ? 'Generating Routes...' : `Generate ${numVolunteers} Route${numVolunteers !== 1 ? 's' : ''} →`}
                </button>

                {computing && (
                  <div className="card p-4">
                    <MapView result={null} isLoading />
                  </div>
                )}
              </div>
            )}

            {mode === 'coordinator' && coordResults && (
              <RouteResults mode="coordinator" results={coordResults} onReset={resetCoord} />
            )}

            {/* ── VOLUNTEER MODE ── */}
            {mode === 'volunteer' && !volResult && (
              <div className="space-y-4">
                <div className="card p-4">
                  <AddressInput
                    label="Your home address"
                    placeholder="Your home address..."
                    value={volunteerHome}
                    onChange={handleVolunteerHomeChange}
                  />
                </div>

                <div className="card p-4 space-y-4">
                  <div>
                    <p className="mb-1 text-xs font-medium text-gray-600">Your assigned delivery addresses</p>
                    <p className="text-xs text-gray-400">Add manually, paste a list, or scan your delivery sheet</p>
                  </div>

                  {/* Image scan section */}
                  <div>
                    <p className="mb-2 text-xs font-semibold text-purple-700">📷 Scan delivery sheet image</p>
                    {showAnthropicKeyPrompt ? (
                      <AnthropicKeyPrompt
                        onKeySubmit={handleAnthropicApiKey}
                        onCancel={() => setShowAnthropicKeyPrompt(false)}
                      />
                    ) : (
                      <ImageAddressInput
                        onAddressesExtracted={handleDeliveriesFromImage}
                        anthropicApiKey={anthropicApiKey || null}
                        onNeedApiKey={() => setShowAnthropicKeyPrompt(true)}
                      />
                    )}
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <p className="mb-2 text-xs font-semibold text-gray-600">Or add addresses manually</p>
                    <AddressList
                      label=""
                      addresses={assignedDeliveries}
                      onChange={setAssignedDeliveries}
                      maxCount={23}
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
                )}

                <button
                  type="button"
                  onClick={handleComputeVolRoute}
                  disabled={computing || !volunteerHome || assignedDeliveries.length === 0}
                  className="btn-primary w-full py-4 text-base"
                >
                  {computing ? 'Computing Route...' : 'Get My Route →'}
                </button>

                {computing && (
                  <div className="card p-4">
                    <MapView result={null} isLoading />
                  </div>
                )}
              </div>
            )}

            {mode === 'volunteer' && volResult && (
              <RouteResults mode="volunteer" result={volResult} onReset={resetVol} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ─── Inline Anthropic Key Prompt ──────────────────────────────────────────────
function AnthropicKeyPrompt({
  onKeySubmit,
  onCancel,
}: {
  onKeySubmit: (key: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 space-y-2">
      <p className="text-sm font-medium text-purple-800">Claude AI Key Required for Image Scanning</p>
      <p className="text-xs text-purple-600">
        Image scanning uses Claude AI to read your delivery sheet.{' '}
        <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="underline">
          Get a free API key →
        </a>
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-ant-..."
          className="input flex-1"
        />
        <button
          type="button"
          onClick={() => { if (value.trim()) onKeySubmit(value.trim()); }}
          disabled={!value.trim()}
          className="btn-primary"
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
      <p className="text-xs text-purple-400">Stored in your browser only. Never sent to any server except Anthropic.</p>
    </div>
  );
}

