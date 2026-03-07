import type { GeocodedAddress, RouteResult, RouteStop, VolunteerEntry, VolunteerRouteResult } from '../types';
import {
  getDistanceMatrix,
  getOptimizedDirections,
  buildGoogleMapsUrl,
  summarizeDirections,
} from './maps';

const MAX_DELIVERY_WAYPOINTS = 23; // Google Directions allows 25 waypoints; nonprofit uses 1

/**
 * Use Case 2 — Volunteer Mode
 * Given home, nonprofit, and assigned deliveries, return the optimal route.
 * Route: Home → Nonprofit → [optimized delivery order] → Home
 */
export async function computeVolunteerRoute(
  home: GeocodedAddress,
  nonprofit: GeocodedAddress,
  deliveries: GeocodedAddress[]
): Promise<RouteResult> {
  if (deliveries.length === 0) throw new Error('No delivery addresses provided.');
  if (deliveries.length > MAX_DELIVERY_WAYPOINTS) {
    throw new Error(`Maximum ${MAX_DELIVERY_WAYPOINTS} delivery addresses allowed per route.`);
  }

  // origin=nonprofit so it is always the guaranteed first stop.
  // destination=home so the route ends at home.
  // waypoint_order from Google indexes directly into deliveries[].
  const directionsResult = await getOptimizedDirections(nonprofit, home, deliveries);
  return buildRouteResult(home, home, nonprofit, deliveries, directionsResult);
}

/**
 * Use Case 1 — Coordinator: compute routes for multiple volunteers from a shared pool.
 *
 * Pre-sorts all addresses by straight-line distance from the nonprofit, then assigns
 * them in a striped pattern (address 0 → vol 1, address 1 → vol 2, …, address N → vol 1, …).
 * This distributes near and far addresses evenly so no single volunteer ends up with
 * all the distant stops.
 *
 * Route per volunteer: Home (or nonprofit) → Nonprofit → [optimized deliveries] → Home (or nonprofit)
 */
export async function computeMultiVolunteerRoutes(
  volunteers: VolunteerEntry[],
  nonprofit: GeocodedAddress,
  pool: GeocodedAddress[]
): Promise<VolunteerRouteResult[]> {
  // Sort pool by straight-line distance from nonprofit so the stripe pattern
  // spreads near/far addresses evenly across volunteers.
  const sorted = [...pool].sort((a, b) => {
    const distA = Math.hypot(a.lat - nonprofit.lat, a.lng - nonprofit.lng);
    const distB = Math.hypot(b.lat - nonprofit.lat, b.lng - nonprofit.lng);
    return distA - distB;
  });

  // Stripe: assign address[i] to volunteer[i % numVolunteers]
  const numVols = volunteers.length;
  const buckets: GeocodedAddress[][] = Array.from({ length: numVols }, () => []);
  sorted.forEach((addr, i) => buckets[i % numVols].push(addr));

  const results: VolunteerRouteResult[] = [];

  for (let vi = 0; vi < volunteers.length; vi++) {
    const volunteer = volunteers[vi];
    const bucket = buckets[vi];
    if (bucket.length === 0) break;

    // Respect the volunteer's numStops cap (already set by calcEvenSplit)
    const numStops = Math.min(volunteer.numStops, bucket.length);
    // Within their bucket, use nearest-neighbor to pick the best numStops and order them
    const selected = await selectBestDeliveries(nonprofit, bucket, numStops);

    const origin = volunteer.homeAddress ?? nonprofit;
    const destination = volunteer.homeAddress ?? nonprofit;

    // Get optimized route for the selected deliveries.
    // origin=nonprofit guarantees it's always the first stop; waypoint_order indexes into selected[].
    try {
      const directionsResult = await getOptimizedDirections(nonprofit, destination, selected);
      const route = buildRouteResult(origin, destination, nonprofit, selected, directionsResult);
      results.push({ volunteer, route });
    } catch (e) {
      const addressList = selected.map((a) => a.formatted).join(', ');
      const msg = e instanceof Error ? e.message : 'Unknown routing error';
      results.push({
        volunteer,
        route: null,
        error: `${msg}\n\nAssigned addresses: ${addressList}`,
      });
    }
  }

  return results;
}

/**
 * Greedy nearest-neighbor selection of numStops addresses from the pool,
 * starting from the nonprofit (always the pickup point).
 *
 * Fetches distances one row at a time (1 origin × N destinations) to stay
 * within Google's 100-element per request limit. The existing batching in
 * getDistanceMatrix handles destination counts > 25 automatically.
 */
async function selectBestDeliveries(
  nonprofit: GeocodedAddress,
  pool: GeocodedAddress[],
  numStops: number
): Promise<GeocodedAddress[]> {
  if (pool.length <= numStops) return [...pool];

  const remaining = pool.slice(0, 100); // cap for quota safety
  const selected: GeocodedAddress[] = [];
  let current: GeocodedAddress = nonprofit;

  for (let i = 0; i < numStops && remaining.length > 0; i++) {
    // Fetch distances from current node to all remaining candidates.
    // Each request is 1 × remaining.length (≤100 elements, batched in ≤25-dest chunks).
    const matrix = await getDistanceMatrix([current], remaining);
    const distances = matrix[0];

    let bestTime = Infinity;
    let bestIdx = -1;
    for (let j = 0; j < distances.length; j++) {
      if (distances[j] < bestTime) {
        bestTime = distances[j];
        bestIdx = j;
      }
    }

    if (bestIdx === -1) break;
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1); // remove from candidates
    current = selected[selected.length - 1];
  }

  return selected;
}

/**
 * Build a RouteResult from a DirectionsResult.
 * Reads waypoint_order to determine the optimized delivery sequence.
 * NOTE: Google's optimizeWaypoints reorders ALL waypoints submitted for optimization.
 * We pass nonprofit as the first waypoint (not optimized) so the order returned
 * is for the delivery waypoints only.
 */
function buildRouteResult(
  origin: GeocodedAddress,
  destination: GeocodedAddress,
  nonprofit: GeocodedAddress,
  deliveries: GeocodedAddress[],
  directionsResult: google.maps.DirectionsResult
): RouteResult {
  // waypoint_order is Google's optimized ordering of the deliveries[] array.
  // Because nonprofit is used as the route origin (not a waypoint), these indices
  // map 1:1 into deliveries[] with no offset — no undefined access possible.
  const waypointOrder = directionsResult.routes[0]?.waypoint_order ?? deliveries.map((_, i) => i);
  const reorderedDeliveries = waypointOrder.map((i) => deliveries[i]);

  // Build stop list
  const stops: RouteStop[] = [];
  let order = 1;

  const isHomeAndNonprofitSame =
    origin.placeId && origin.placeId === nonprofit.placeId;

  stops.push({ order: order++, address: origin, label: 'Start', isFixed: true });

  if (!isHomeAndNonprofitSame) {
    stops.push({ order: order++, address: nonprofit, label: 'Casa San Jose (Pickup)', isFixed: true });
  }

  for (let i = 0; i < reorderedDeliveries.length; i++) {
    stops.push({
      order: order++,
      address: reorderedDeliveries[i],
      label: `Delivery ${i + 1}`,
      isFixed: false,
    });
  }

  const isSameOriginDest =
    origin.placeId && origin.placeId === destination.placeId;
  const isReturnHome = origin !== nonprofit || isSameOriginDest;

  if (isReturnHome) {
    stops.push({ order: order++, address: destination, label: 'Return Home', isFixed: true });
  }

  const { durationSeconds, distanceMeters } = summarizeDirections(directionsResult);

  const orderedForUrl = [origin, nonprofit, ...reorderedDeliveries, destination];
  const googleMapsUrl = buildGoogleMapsUrl(orderedForUrl);

  return {
    stops,
    directionsResult,
    googleMapsUrl,
    totalDurationMinutes: Math.round(durationSeconds / 60),
    totalDistanceMiles: Math.round((distanceMeters / 1609.34) * 10) / 10,
  };
}
