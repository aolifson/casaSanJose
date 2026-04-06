export interface GeocodedAddress {
  raw: string;
  formatted: string;
  lat: number;
  lng: number;
  placeId?: string;
  postalCode?: string;
  sourceType?: 'address' | 'zip' | 'neighborhood';
}

export interface VolunteerEntry {
  id: string;
  name: string;
  phone?: string;
  homeAddress: GeocodedAddress | null;
  homeNeighborhood?: string;
  homeZipCode?: string;
  numStops: number;
}

export interface PriorDeliveryAssignment {
  zipCode: string;
  volunteerName: string;
  neighborhood?: string;
}

export interface DeliverySheetDriver {
  name: string;
  neighborhood: string;
}

export interface ParsedDeliverySheet {
  deliveryZipCodes: string[];
  priorAssignments: PriorDeliveryAssignment[];
  drivers: DeliverySheetDriver[];
}

export interface WeeklySheetSource {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  workbookName?: string;
  tabName?: string;
}

export interface WeeklySheetContext extends ParsedDeliverySheet {
  source?: WeeklySheetSource;
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
