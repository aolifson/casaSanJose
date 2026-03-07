import { useEffect, useRef, useState } from 'react';
import type { RouteResult } from '../types';

interface MapViewProps {
  result: RouteResult | null;
  isLoading?: boolean;
}

// Colors for numbered stop markers
const MARKER_COLORS: Record<string, string> = {
  fixed: '#6b7280',
  delivery: '#d97706',
};

export default function MapView({ result, isLoading }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;

    googleMapRef.current = new google.maps.Map(mapRef.current, {
      center: { lat: 40.4406, lng: -79.9959 }, // Pittsburgh, PA
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });

    rendererRef.current = new google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#d97706', strokeWeight: 4, strokeOpacity: 0.8 },
    });

    rendererRef.current.setMap(googleMapRef.current);
    setMapReady(true);
  }, []);

  // Update route when result changes
  useEffect(() => {
    if (!mapReady || !googleMapRef.current || !rendererRef.current) return;

    // Clear previous markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (!result) {
      rendererRef.current.setDirections({ routes: [] } as unknown as google.maps.DirectionsResult);
      return;
    }

    rendererRef.current.setDirections(result.directionsResult);

    // Add numbered markers for each stop
    result.stops.forEach((stop) => {
      const color = stop.isFixed ? MARKER_COLORS.fixed : MARKER_COLORS.delivery;
      const marker = new google.maps.Marker({
        position: { lat: stop.address.lat, lng: stop.address.lng },
        map: googleMapRef.current!,
        label: {
          text: String(stop.order),
          color: '#fff',
          fontWeight: 'bold',
          fontSize: '12px',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
          scale: 16,
        },
        title: `${stop.label}: ${stop.address.formatted}`,
      });

      // Info window on click
      const infoWindow = new google.maps.InfoWindow({
        content: `<div style="font-size:13px"><strong>${stop.label}</strong><br/>${stop.address.formatted}</div>`,
      });
      marker.addListener('click', () => infoWindow.open(googleMapRef.current!, marker));

      markersRef.current.push(marker);
    });

    // Fit bounds
    if (result.directionsResult.routes[0]?.bounds) {
      googleMapRef.current.fitBounds(result.directionsResult.routes[0].bounds, 60);
    }
  }, [result, mapReady]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 shadow-sm" style={{ height: 380 }}>
      <div ref={mapRef} className="h-full w-full" />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-200 border-t-amber-600" />
            <p className="text-sm font-medium text-gray-600">Computing route...</p>
          </div>
        </div>
      )}
      {!result && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-gray-400">Route will appear here</p>
        </div>
      )}
    </div>
  );
}
