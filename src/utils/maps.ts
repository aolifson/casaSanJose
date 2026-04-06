import type { GeocodedAddress, GeocodingProgress } from '../types';

let mapsLoaded = false;

const PITTSBURGH_BOUNDS: google.maps.LatLngBoundsLiteral = {
  north: 40.65,
  south: 40.20,
  east: -79.70,
  west: -80.40,
};

/**
 * Load the Google Maps JavaScript SDK once. Idempotent.
 */
export async function loadMapsApi(apiKey: string): Promise<void> {
  if (mapsLoaded) return;

  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      mapsLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      mapsLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Google Maps SDK. Check your API key.'));
    document.head.appendChild(script);
  });
}

/**
 * Geocode a single raw address string into a GeocodedAddress.
 */
export async function geocodeAddress(raw: string): Promise<GeocodedAddress> {
  const geocoder = new google.maps.Geocoder();
  return geocodeWithRequest(geocoder, raw, {
    address: raw,
    componentRestrictions: { country: 'US', administrativeArea: 'PA' },
    bounds: PITTSBURGH_BOUNDS,
  });
}

function findPostalCode(components: google.maps.GeocoderAddressComponent[] = []): string | undefined {
  const postal = components.find((component) => component.types.includes('postal_code'))?.long_name;
  return postal?.replace(/\D/g, '').slice(0, 5) || undefined;
}

async function geocodeWithRequest(
  geocoder: google.maps.Geocoder,
  raw: string,
  request: google.maps.GeocoderRequest,
  sourceType: GeocodedAddress['sourceType'] = 'address'
): Promise<GeocodedAddress> {
  const result = await geocoder.geocode(request);

  if (!result.results || result.results.length === 0) {
    throw new Error(`Could not geocode address: "${raw}"`);
  }

  const top = result.results[0];
  let postalCode = findPostalCode(top.address_components);

  if (!postalCode) {
    const reverse = await geocoder.geocode({
      location: top.geometry.location,
    });
    postalCode = findPostalCode(reverse.results[0]?.address_components);
  }

  return {
    raw,
    formatted: top.formatted_address,
    lat: top.geometry.location.lat(),
    lng: top.geometry.location.lng(),
    placeId: top.place_id,
    postalCode,
    sourceType,
  };
}

function normalizeNeighborhood(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function geocodeZipCode(zipCode: string): Promise<GeocodedAddress> {
  const geocoder = new google.maps.Geocoder();
  const normalizedZip = zipCode.replace(/\D/g, '').slice(0, 5);

  return geocodeWithRequest(
    geocoder,
    normalizedZip,
    {
      address: `${normalizedZip}, PA`,
      componentRestrictions: { country: 'US', administrativeArea: 'PA', postalCode: normalizedZip },
      bounds: PITTSBURGH_BOUNDS,
    },
    'zip'
  );
}

export async function geocodeNeighborhood(neighborhood: string): Promise<GeocodedAddress> {
  const geocoder = new google.maps.Geocoder();
  const cleaned = normalizeNeighborhood(neighborhood);

  return geocodeWithRequest(
    geocoder,
    neighborhood,
    {
      address: `${cleaned}, Pennsylvania`,
      componentRestrictions: { country: 'US', administrativeArea: 'PA' },
      bounds: PITTSBURGH_BOUNDS,
    },
    'neighborhood'
  );
}

async function geocodeBatch(
  raws: string[],
  onProgress: (p: GeocodingProgress) => void,
  geocodeFn: (raw: string) => Promise<GeocodedAddress>
): Promise<GeocodedAddress[]> {
  const CONCURRENCY = 10;
  const results: GeocodedAddress[] = [];
  const failed: string[] = [];
  let completed = 0;

  const report = () =>
    onProgress({ total: raws.length, completed, failed: [...failed] });

  report();

  for (let i = 0; i < raws.length; i += CONCURRENCY) {
    const chunk = raws.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((raw) => geocodeFn(raw)));

    for (let j = 0; j < settled.length; j++) {
      const result = settled[j];
      completed++;
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        failed.push(chunk[j]);
      }
      report();
    }
  }

  return results;
}

/**
 * Geocode multiple addresses in parallel (max 10 concurrent).
 * Fires onProgress callback after each completion.
 * Returns successfully geocoded results; failed addresses are included in progress.failed.
 */
export async function geocodeAddressBatch(
  raws: string[],
  onProgress: (p: GeocodingProgress) => void
): Promise<GeocodedAddress[]> {
  return geocodeBatch(raws, onProgress, geocodeAddress);
}

export async function geocodeZipCodeBatch(
  zipCodes: string[],
  onProgress: (p: GeocodingProgress) => void
): Promise<GeocodedAddress[]> {
  return geocodeBatch(zipCodes, onProgress, geocodeZipCode);
}

export async function geocodeNeighborhoodBatch(
  neighborhoods: string[],
  onProgress: (p: GeocodingProgress) => void
): Promise<GeocodedAddress[]> {
  return geocodeBatch(neighborhoods, onProgress, geocodeNeighborhood);
}

/**
 * Build a Distance Matrix for origins × destinations.
 * Returns a 2D array [originIdx][destIdx] = travel seconds.
 * Uses Infinity for unreachable pairs.
 * Batches in chunks of 25×25 to stay within API limits.
 */
export async function getDistanceMatrix(
  origins: GeocodedAddress[],
  destinations: GeocodedAddress[]
): Promise<number[][]> {
  const BATCH = 25;
  const matrix: number[][] = Array.from({ length: origins.length }, () =>
    new Array(destinations.length).fill(Infinity)
  );

  const service = new google.maps.DistanceMatrixService();

  for (let oi = 0; oi < origins.length; oi += BATCH) {
    const origBatch = origins.slice(oi, oi + BATCH);
    for (let di = 0; di < destinations.length; di += BATCH) {
      const destBatch = destinations.slice(di, di + BATCH);

      const response = await new Promise<google.maps.DistanceMatrixResponse>(
        (resolve, reject) => {
          service.getDistanceMatrix(
            {
              origins: origBatch.map((a) => ({ lat: a.lat, lng: a.lng })),
              destinations: destBatch.map((a) => ({ lat: a.lat, lng: a.lng })),
              travelMode: google.maps.TravelMode.DRIVING,
              unitSystem: google.maps.UnitSystem.IMPERIAL,
            },
            (result, status) => {
              if (status === 'OK' && result) resolve(result);
              else reject(new Error(`Distance Matrix error: ${status}`));
            }
          );
        }
      );

      for (let i = 0; i < origBatch.length; i++) {
        for (let j = 0; j < destBatch.length; j++) {
          const el = response.rows[i]?.elements[j];
          if (el?.status === 'OK') {
            matrix[oi + i][di + j] = el.duration.value; // seconds
          }
        }
      }
    }
  }

  return matrix;
}

/**
 * Get an optimized route via the Directions API.
 *
 * Uses `nonprofit` as the route origin so it is always the guaranteed first stop.
 * Only delivery addresses are submitted as waypoints, so `waypoint_order` returned
 * by Google indexes directly into `deliveries[]` with no offset — preventing the
 * "Cannot read properties of undefined" crash that occurs when nonprofit is mixed
 * into the waypoints array and Google reorders it.
 *
 * - origin: nonprofit address (route starts here; caller shows home→nonprofit separately)
 * - destination: volunteer's home, or nonprofit again if no home address
 * - deliveries: delivery addresses to optimize
 */
export async function getOptimizedDirections(
  origin: GeocodedAddress,
  destination: GeocodedAddress,
  deliveries: GeocodedAddress[]
): Promise<google.maps.DirectionsResult> {
  const service = new google.maps.DirectionsService();

  const toLocation = (a: GeocodedAddress): google.maps.Place | google.maps.LatLngLiteral =>
    a.placeId ? { placeId: a.placeId } : { lat: a.lat, lng: a.lng };

  const waypoints: google.maps.DirectionsWaypoint[] = deliveries.map((a) => ({
    location: toLocation(a),
    stopover: true,
  }));

  const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
    service.route(
      {
        origin: toLocation(origin),
        destination: toLocation(destination),
        waypoints,
        optimizeWaypoints: true,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === 'OK' && result) resolve(result);
        else reject(new Error(`Directions API error: ${status}. Check that all addresses are reachable by car.`));
      }
    );
  });

  return result;
}

/**
 * Build a Google Maps deep-link URL from an ordered array of addresses.
 */
export function buildGoogleMapsUrl(orderedAddresses: GeocodedAddress[]): string {
  const parts = orderedAddresses.map((a) => encodeURIComponent(a.formatted));
  return `https://www.google.com/maps/dir/${parts.join('/')}`;
}

/**
 * Extract total duration and distance from a DirectionsResult.
 */
export function summarizeDirections(result: google.maps.DirectionsResult): {
  durationSeconds: number;
  distanceMeters: number;
} {
  let durationSeconds = 0;
  let distanceMeters = 0;

  const legs = result.routes[0]?.legs ?? [];
  for (const leg of legs) {
    durationSeconds += leg.duration?.value ?? 0;
    distanceMeters += leg.distance?.value ?? 0;
  }

  return { durationSeconds, distanceMeters };
}
