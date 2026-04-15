import type {
  GeocodedAddress,
  PriorDeliveryAssignment,
  RouteResult,
  RouteStop,
  VolunteerEntry,
  VolunteerRouteResult,
} from '../types';
import {
  getDistanceMatrix,
  getOptimizedDirections,
  buildGoogleMapsUrl,
  summarizeDirections,
} from './maps';

const MAX_DELIVERY_WAYPOINTS = 23; // Google Directions allows 25 waypoints; nonprofit uses 1
const LOAD_PENALTY_PER_STOP = 0.01;
const ZIP_SPLIT_IMPROVEMENT_THRESHOLD = 0.03;
const DELIVERY_TIME_BUFFER_MINUTES = 15;
const MAX_ROUTE_REBALANCE_ATTEMPTS = 24;
const MOVE_CANDIDATE_COUNT = 5;
const RECIPIENT_CANDIDATE_COUNT = 4;

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

  const rebalancedBuckets = await rebalanceBucketsForRouteLimits(volunteers, nonprofit, buckets);
  return buildRoutesForBuckets(volunteers, nonprofit, rebalancedBuckets);
}

export async function computeNeighborhoodRoutes(
  volunteers: VolunteerEntry[],
  nonprofit: GeocodedAddress,
  deliveries: GeocodedAddress[],
  priorAssignments: PriorDeliveryAssignment[]
): Promise<VolunteerRouteResult[]> {
  const activeVolunteers = volunteers.filter((volunteer) => volunteer.numStops > 0);
  const buckets: GeocodedAddress[][] = Array.from({ length: activeVolunteers.length }, () => []);
  const remainingCapacity = activeVolunteers.map((volunteer) => Math.max(0, volunteer.numStops));
  const availableDeliveries = deliveries.map((address, index) => ({
    address,
    index,
    zipCode: extractZipCode(address),
  }));

  const priorCounts = buildPriorAssignmentCounts(priorAssignments, activeVolunteers);
  const unassignedIndexes = new Set(availableDeliveries.map((delivery) => delivery.index));

  for (const delivery of availableDeliveries) {
    const matchedVolunteerIndex = findBestPriorVolunteerIndex(
      delivery.zipCode,
      activeVolunteers,
      remainingCapacity,
      priorCounts
    );

    if (matchedVolunteerIndex === -1) continue;

    buckets[matchedVolunteerIndex].push(delivery.address);
    remainingCapacity[matchedVolunteerIndex] -= 1;
    unassignedIndexes.delete(delivery.index);

    const key = makePriorAssignmentKey(activeVolunteers[matchedVolunteerIndex].id, delivery.zipCode);
    priorCounts.set(key, (priorCounts.get(key) ?? 1) - 1);
  }

  const remainingDeliveries = availableDeliveries.filter((delivery) => unassignedIndexes.has(delivery.index));
  const remainingZipGroups = groupDeliveriesByZip(remainingDeliveries);

  for (const zipGroup of remainingZipGroups) {
    for (const delivery of zipGroup) {
      const volunteerIndex = findBestVolunteerIndexForDelivery(
        delivery.address,
        delivery.zipCode,
        activeVolunteers,
        nonprofit,
        remainingCapacity,
        buckets
      );
      if (volunteerIndex === -1) continue;

      buckets[volunteerIndex].push(delivery.address);
      remainingCapacity[volunteerIndex] -= 1;
    }
  }

  const rebalancedBuckets = await rebalanceBucketsForRouteLimits(activeVolunteers, nonprofit, buckets);
  return buildRoutesForBuckets(activeVolunteers, nonprofit, rebalancedBuckets);
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

function extractZipCode(address: GeocodedAddress): string {
  return address.postalCode?.replace(/\D/g, '').slice(0, 5)
    || address.raw.replace(/\D/g, '').slice(0, 5)
    || address.formatted.replace(/\D/g, '').slice(0, 5);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenizeName(value: string): string[] {
  return normalizeName(value)
    .split(' ')
    .filter((token) => token && token !== 'and');
}

function matchVolunteerName(
  priorVolunteerName: string,
  volunteers: VolunteerEntry[]
): VolunteerEntry | null {
  const normalizedPrior = normalizeName(priorVolunteerName);
  const priorTokens = tokenizeName(priorVolunteerName);
  let bestMatch: VolunteerEntry | null = null;
  let bestScore = 0;

  for (const volunteer of volunteers) {
    const normalizedVolunteer = normalizeName(volunteer.name);
    if (normalizedVolunteer === normalizedPrior) {
      return volunteer;
    }

    const volunteerTokens = tokenizeName(volunteer.name);
    const overlap = volunteerTokens.filter((token) => priorTokens.includes(token)).length;
    let score = overlap * 10;

    if (normalizedVolunteer.includes(normalizedPrior) || normalizedPrior.includes(normalizedVolunteer)) {
      score += 30;
    }

    if (overlap > 0 && overlap === priorTokens.length) {
      score += 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = volunteer;
    }
  }

  return bestScore >= 20 ? bestMatch : null;
}

function makePriorAssignmentKey(volunteerId: string, zipCode: string): string {
  return `${volunteerId}:${zipCode}`;
}

function buildPriorAssignmentCounts(
  priorAssignments: PriorDeliveryAssignment[],
  volunteers: VolunteerEntry[]
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const assignment of priorAssignments) {
    const matchedVolunteer = matchVolunteerName(assignment.volunteerName, volunteers);
    if (!matchedVolunteer) continue;

    const key = makePriorAssignmentKey(matchedVolunteer.id, assignment.zipCode);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function findBestPriorVolunteerIndex(
  zipCode: string,
  volunteers: VolunteerEntry[],
  remainingCapacity: number[],
  priorCounts: Map<string, number>
): number {
  let bestIndex = -1;
  let bestCount = 0;

  for (let i = 0; i < volunteers.length; i++) {
    if (remainingCapacity[i] <= 0) continue;

    const count = priorCounts.get(makePriorAssignmentKey(volunteers[i].id, zipCode)) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function distanceBetween(a: GeocodedAddress, b: GeocodedAddress): number {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng);
}

function groupDeliveriesByZip<
  T extends {
    address: GeocodedAddress;
    zipCode: string;
  },
>(deliveries: T[]): T[][] {
  const groups = new Map<string, T[]>();

  for (const delivery of deliveries) {
    const key = delivery.zipCode || `${delivery.address.lat},${delivery.address.lng}`;
    const existing = groups.get(key) ?? [];
    existing.push(delivery);
    groups.set(key, existing);
  }

  return [...groups.values()].sort((a, b) => b.length - a.length);
}

function scoreVolunteerForDelivery(
  delivery: GeocodedAddress,
  volunteer: VolunteerEntry,
  nonprofit: GeocodedAddress,
  bucket: GeocodedAddress[]
): number {
  const anchor = volunteer.homeAddress ?? nonprofit;
  const anchors = bucket.length > 0 ? [anchor, ...bucket] : [anchor];
  const closestAssignedStop = Math.min(...anchors.map((candidate) => distanceBetween(candidate, delivery)));
  const loadPenalty = bucket.length * LOAD_PENALTY_PER_STOP;
  return closestAssignedStop + loadPenalty;
}

function findBestScoredVolunteer(
  delivery: GeocodedAddress,
  volunteers: VolunteerEntry[],
  nonprofit: GeocodedAddress,
  remainingCapacity: number[],
  buckets: GeocodedAddress[][],
  candidateIndexes?: number[]
): { index: number; score: number } {
  let bestIndex = -1;
  let bestScore = Infinity;

  const indexes = candidateIndexes ?? volunteers.map((_, index) => index);

  for (const i of indexes) {
    if (remainingCapacity[i] <= 0) continue;
    const score = scoreVolunteerForDelivery(delivery, volunteers[i], nonprofit, buckets[i]);

    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return { index: bestIndex, score: bestScore };
}

function findZipOwnerIndexes(zipCode: string, buckets: GeocodedAddress[][]): number[] {
  const owners: number[] = [];

  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].some((address) => extractZipCode(address) === zipCode)) {
      owners.push(i);
    }
  }

  return owners;
}

function findBestVolunteerIndexForDelivery(
  delivery: GeocodedAddress,
  zipCode: string,
  volunteers: VolunteerEntry[],
  nonprofit: GeocodedAddress,
  remainingCapacity: number[],
  buckets: GeocodedAddress[][]
): number {
  const bestOverall = findBestScoredVolunteer(
    delivery,
    volunteers,
    nonprofit,
    remainingCapacity,
    buckets
  );

  if (bestOverall.index === -1) {
    return -1;
  }

  const zipOwners = findZipOwnerIndexes(zipCode, buckets);
  if (zipOwners.length === 0) {
    return bestOverall.index;
  }

  const bestExistingOwner = findBestScoredVolunteer(
    delivery,
    volunteers,
    nonprofit,
    remainingCapacity,
    buckets,
    zipOwners
  );

  if (bestExistingOwner.index === -1 || bestExistingOwner.index === bestOverall.index) {
    return bestOverall.index;
  }

  if (bestOverall.score + ZIP_SPLIT_IMPROVEMENT_THRESHOLD < bestExistingOwner.score) {
    return bestOverall.index;
  }

  return bestExistingOwner.index;
}

function buildAddressKey(address: GeocodedAddress): string {
  return address.placeId
    || `${address.formatted}|${address.postalCode ?? ''}|${address.lat.toFixed(5)}|${address.lng.toFixed(5)}`;
}

function buildBucketCacheKey(volunteer: VolunteerEntry, bucket: GeocodedAddress[]): string {
  const volunteerKey = volunteer.homeAddress?.placeId
    || volunteer.homeAddress?.formatted
    || volunteer.homeNeighborhood
    || volunteer.id;
  const bucketKey = bucket
    .map(buildAddressKey)
    .sort()
    .join('||');
  return `${volunteer.id}|${volunteerKey}|${bucketKey}`;
}

function getVolunteerRouteTargetMinutes(volunteer: VolunteerEntry): number {
  if (!volunteer.maxRouteMinutes || !Number.isFinite(volunteer.maxRouteMinutes)) {
    return Infinity;
  }

  return Math.max(0, volunteer.maxRouteMinutes - DELIVERY_TIME_BUFFER_MINUTES);
}

function getRouteDurationMinutes(result: VolunteerRouteResult): number {
  return result.route?.totalDurationMinutes ?? 0;
}

function getRouteOverflowMinutes(volunteer: VolunteerEntry, result: VolunteerRouteResult): number {
  const target = getVolunteerRouteTargetMinutes(volunteer);
  if (!Number.isFinite(target) || !result.route) return 0;
  return Math.max(0, result.route.totalDurationMinutes - target);
}

function removeDeliveryFromBucket(bucket: GeocodedAddress[], delivery: GeocodedAddress): GeocodedAddress[] | null {
  const index = bucket.findIndex((candidate) => candidate === delivery);
  if (index === -1) return null;

  return [
    ...bucket.slice(0, index),
    ...bucket.slice(index + 1),
  ];
}

function getMoveCandidateDeliveries(
  volunteer: VolunteerEntry,
  nonprofit: GeocodedAddress,
  bucket: GeocodedAddress[],
  result: VolunteerRouteResult
): GeocodedAddress[] {
  if (bucket.length === 0) return [];

  const orderedDeliveries = result.route
    ? result.route.stops.filter((stop) => !stop.isFixed).map((stop) => stop.address)
    : [...bucket];
  const routeTail = [...orderedDeliveries].reverse().slice(0, Math.min(3, orderedDeliveries.length));
  const anchor = volunteer.homeAddress ?? nonprofit;
  const farthest = [...bucket]
    .sort((a, b) => distanceBetween(anchor, b) - distanceBetween(anchor, a))
    .slice(0, Math.min(2, bucket.length));

  const candidates: GeocodedAddress[] = [];
  for (const candidate of [...routeTail, ...farthest]) {
    if (!candidates.some((existing) => existing === candidate)) {
      candidates.push(candidate);
    }
    if (candidates.length >= MOVE_CANDIDATE_COUNT) break;
  }

  return candidates.length > 0 ? candidates : [bucket[bucket.length - 1]];
}

function getRecipientCandidateIndexes(
  donorIndex: number,
  delivery: GeocodedAddress,
  volunteers: VolunteerEntry[],
  nonprofit: GeocodedAddress,
  buckets: GeocodedAddress[][]
): number[] {
  return volunteers
    .map((_, index) => index)
    .filter((index) => index !== donorIndex && buckets[index].length < MAX_DELIVERY_WAYPOINTS)
    .sort((a, b) => {
      const scoreA = scoreVolunteerForDelivery(delivery, volunteers[a], nonprofit, buckets[a]);
      const scoreB = scoreVolunteerForDelivery(delivery, volunteers[b], nonprofit, buckets[b]);
      return scoreA - scoreB;
    })
    .slice(0, RECIPIENT_CANDIDATE_COUNT);
}

async function computeRouteForVolunteerBucket(
  volunteer: VolunteerEntry,
  nonprofit: GeocodedAddress,
  bucket: GeocodedAddress[],
  cache: Map<string, VolunteerRouteResult>
): Promise<VolunteerRouteResult> {
  if (bucket.length === 0) {
    return { volunteer, route: null };
  }

  const cacheKey = buildBucketCacheKey(volunteer, bucket);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (bucket.length > MAX_DELIVERY_WAYPOINTS) {
    const result = {
      volunteer,
      route: null,
      error: `Maximum ${MAX_DELIVERY_WAYPOINTS} delivery addresses allowed per route.`,
    };
    cache.set(cacheKey, result);
    return result;
  }

  const origin = volunteer.homeAddress ?? nonprofit;
  const destination = volunteer.homeAddress ?? nonprofit;

  try {
    const directionsResult = await getOptimizedDirections(nonprofit, destination, bucket);
    const route = buildRouteResult(origin, destination, nonprofit, bucket, directionsResult);
    const result = { volunteer, route };
    cache.set(cacheKey, result);
    return result;
  } catch (e) {
    const addressList = bucket.map((address) => address.formatted).join(', ');
    const msg = e instanceof Error ? e.message : 'Unknown routing error';
    const result = {
      volunteer,
      route: null,
      error: `${msg}\n\nAssigned addresses: ${addressList}`,
    };
    cache.set(cacheKey, result);
    return result;
  }
}

async function computeRoutesForBuckets(
  volunteers: VolunteerEntry[],
  nonprofit: GeocodedAddress,
  buckets: GeocodedAddress[][],
  cache: Map<string, VolunteerRouteResult>
): Promise<VolunteerRouteResult[]> {
  const results: VolunteerRouteResult[] = [];

  for (let index = 0; index < volunteers.length; index++) {
    results.push(await computeRouteForVolunteerBucket(volunteers[index], nonprofit, buckets[index], cache));
  }

  return results;
}

async function rebalanceBucketsForRouteLimits(
  volunteers: VolunteerEntry[],
  nonprofit: GeocodedAddress,
  buckets: GeocodedAddress[][]
): Promise<GeocodedAddress[][]> {
  if (!volunteers.some((volunteer) => Number.isFinite(getVolunteerRouteTargetMinutes(volunteer)))) {
    return buckets;
  }

  const cache = new Map<string, VolunteerRouteResult>();
  const workingBuckets = buckets.map((bucket) => [...bucket]);
  const currentRoutes = await computeRoutesForBuckets(volunteers, nonprofit, workingBuckets, cache);

  for (let attempt = 0; attempt < MAX_ROUTE_REBALANCE_ATTEMPTS; attempt++) {
    let donorIndex = -1;
    let donorOverflow = 0;

    for (let index = 0; index < volunteers.length; index++) {
      const overflow = getRouteOverflowMinutes(volunteers[index], currentRoutes[index]);
      if (overflow > donorOverflow && workingBuckets[index].length > 0) {
        donorOverflow = overflow;
        donorIndex = index;
      }
    }

    if (donorIndex === -1 || donorOverflow <= 0) break;

    const moveCandidates = getMoveCandidateDeliveries(
      volunteers[donorIndex],
      nonprofit,
      workingBuckets[donorIndex],
      currentRoutes[donorIndex]
    );

    const donorCurrent = currentRoutes[donorIndex];
    let bestMove:
      | {
          donorIndex: number;
          recipientIndex: number;
          delivery: GeocodedAddress;
          donorBucket: GeocodedAddress[];
          recipientBucket: GeocodedAddress[];
          donorResult: VolunteerRouteResult;
          recipientResult: VolunteerRouteResult;
          overflowAfter: number;
          durationDelta: number;
        }
      | null = null;

    for (const delivery of moveCandidates) {
      const nextDonorBucket = removeDeliveryFromBucket(workingBuckets[donorIndex], delivery);
      if (!nextDonorBucket) continue;

      const donorResult = await computeRouteForVolunteerBucket(
        volunteers[donorIndex],
        nonprofit,
        nextDonorBucket,
        cache
      );
      const recipientIndexes = getRecipientCandidateIndexes(
        donorIndex,
        delivery,
        volunteers,
        nonprofit,
        workingBuckets
      );

      for (const recipientIndex of recipientIndexes) {
        const nextRecipientBucket = [...workingBuckets[recipientIndex], delivery];
        const recipientResult = await computeRouteForVolunteerBucket(
          volunteers[recipientIndex],
          nonprofit,
          nextRecipientBucket,
          cache
        );

        if (recipientResult.error || donorResult.error) continue;

        const overflowBefore =
          getRouteOverflowMinutes(volunteers[donorIndex], donorCurrent)
          + getRouteOverflowMinutes(volunteers[recipientIndex], currentRoutes[recipientIndex]);
        const overflowAfter =
          getRouteOverflowMinutes(volunteers[donorIndex], donorResult)
          + getRouteOverflowMinutes(volunteers[recipientIndex], recipientResult);

        if (overflowAfter >= overflowBefore) continue;

        const durationDelta =
          getRouteDurationMinutes(donorResult)
          + getRouteDurationMinutes(recipientResult)
          - getRouteDurationMinutes(donorCurrent)
          - getRouteDurationMinutes(currentRoutes[recipientIndex]);

        if (
          !bestMove
          || overflowAfter < bestMove.overflowAfter
          || (overflowAfter === bestMove.overflowAfter && durationDelta < bestMove.durationDelta)
        ) {
          bestMove = {
            donorIndex,
            recipientIndex,
            delivery,
            donorBucket: nextDonorBucket,
            recipientBucket: nextRecipientBucket,
            donorResult,
            recipientResult,
            overflowAfter,
            durationDelta,
          };
        }
      }
    }

    if (!bestMove) break;

    workingBuckets[bestMove.donorIndex] = bestMove.donorBucket;
    workingBuckets[bestMove.recipientIndex] = bestMove.recipientBucket;
    currentRoutes[bestMove.donorIndex] = bestMove.donorResult;
    currentRoutes[bestMove.recipientIndex] = bestMove.recipientResult;
  }

  return workingBuckets;
}

async function buildRoutesForBuckets(
  volunteers: VolunteerEntry[],
  nonprofit: GeocodedAddress,
  buckets: GeocodedAddress[][]
): Promise<VolunteerRouteResult[]> {
  const cache = new Map<string, VolunteerRouteResult>();
  const results = await computeRoutesForBuckets(volunteers, nonprofit, buckets, cache);
  return results.filter((_, index) => buckets[index].length > 0);
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
