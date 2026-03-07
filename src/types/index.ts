export interface GeocodedAddress {
  raw: string;
  formatted: string;
  lat: number;
  lng: number;
  placeId?: string;
}

export interface VolunteerEntry {
  id: string;
  name: string;
  phone?: string;
  homeAddress: GeocodedAddress | null;
  numStops: number;
}

export interface RouteStop {
  order: number;
  address: GeocodedAddress;
  label: string;
  isFixed: boolean;
}

export interface RouteResult {
  stops: RouteStop[];
  directionsResult: google.maps.DirectionsResult;
  googleMapsUrl: string;
  totalDurationMinutes: number;
  totalDistanceMiles: number;
}

export interface VolunteerRouteResult {
  volunteer: VolunteerEntry;
  route: RouteResult | null;
  error?: string;
}

export type AppMode = 'coordinator' | 'volunteer';

export interface GeocodingProgress {
  total: number;
  completed: number;
  failed: string[];
}
