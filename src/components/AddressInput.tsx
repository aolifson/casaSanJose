import { useRef, useState, useEffect } from 'react';
import type { GeocodedAddress } from '../types';

interface AddressInputProps {
  label: string;
  placeholder?: string;
  value: GeocodedAddress | null;
  onChange: (address: GeocodedAddress | null) => void;
  disabled?: boolean;
}

export default function AddressInput({
  label,
  placeholder = 'Start typing an address...',
  value,
  onChange,
  disabled,
}: AddressInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [inputValue, setInputValue] = useState(value?.formatted ?? '');

  // Sync external value changes (e.g. loaded from localStorage)
  useEffect(() => {
    setInputValue(value?.formatted ?? '');
  }, [value?.formatted]);

  useEffect(() => {
    if (!inputRef.current || !window.google?.maps?.places) return;

    autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
      types: ['address'],
      fields: ['formatted_address', 'geometry', 'place_id'],
    });

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current!.getPlace();
      if (!place.geometry?.location) return;

      const geocoded: GeocodedAddress = {
        raw: place.formatted_address ?? '',
        formatted: place.formatted_address ?? '',
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        placeId: place.place_id,
      };

      setInputValue(geocoded.formatted);
      onChange(geocoded);
    });

    return () => {
      google.maps.event.clearInstanceListeners(autocompleteRef.current!);
    };
  }, [onChange]);

  const handleClear = () => {
    setInputValue('');
    onChange(null);
    inputRef.current?.focus();
  };

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (!e.target.value) onChange(null);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="input pr-8"
        />
        {inputValue && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear address"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
