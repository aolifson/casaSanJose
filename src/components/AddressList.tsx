import { useState } from 'react';
import type { GeocodedAddress } from '../types';
import AddressInput from './AddressInput';
import { geocodeAddress } from '../utils/maps';

interface AddressListProps {
  label: string;
  addresses: GeocodedAddress[];
  onChange: (addresses: GeocodedAddress[]) => void;
  maxCount?: number;
}

export default function AddressList({ label, addresses, onChange, maxCount }: AddressListProps) {
  const [pendingAdd, setPendingAdd] = useState<GeocodedAddress | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

  const isAtMax = maxCount !== undefined && addresses.length >= maxCount;

  const handleAdd = (addr: GeocodedAddress | null) => {
    if (!addr) return;
    // Deduplicate
    const isDuplicate = addresses.some(
      (a) => (a.placeId && a.placeId === addr.placeId) || a.formatted === addr.formatted
    );
    if (isDuplicate) return;
    onChange([...addresses, addr]);
    setPendingAdd(null);
  };

  const handleRemove = (idx: number) => {
    onChange(addresses.filter((_, i) => i !== idx));
  };

  const handleBulkPaste = async () => {
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setBulkLoading(true);
    setBulkErrors([]);

    const errors: string[] = [];
    const newAddresses: GeocodedAddress[] = [];

    for (const line of lines) {
      try {
        const geocoded = await geocodeAddress(line);
        const isDuplicate = [...addresses, ...newAddresses].some(
          (a) => (a.placeId && a.placeId === geocoded.placeId) || a.formatted === geocoded.formatted
        );
        if (!isDuplicate) newAddresses.push(geocoded);
      } catch {
        errors.push(line);
      }
    }

    setBulkLoading(false);
    setBulkErrors(errors);
    setBulkText('');
    if (newAddresses.length > 0) {
      onChange([...addresses, ...newAddresses]);
    }
    if (errors.length === 0) setBulkMode(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-600">
          {label} <span className="text-gray-400">({addresses.length}{maxCount ? `/${maxCount}` : ''})</span>
        </label>
        <button
          type="button"
          onClick={() => setBulkMode(!bulkMode)}
          className="text-xs text-amber-600 hover:underline"
        >
          {bulkMode ? 'Single add' : 'Paste multiple'}
        </button>
      </div>

      {/* Address chips */}
      {addresses.length > 0 && (
        <ul className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-2">
          {addresses.map((addr, idx) => (
            <li
              key={addr.placeId ?? addr.formatted}
              className="flex items-start justify-between gap-2 rounded-md bg-white px-3 py-2 text-xs shadow-sm"
            >
              <span className="text-gray-700">
                <span className="mr-2 inline-block w-5 text-center font-bold text-amber-600">
                  {idx + 1}
                </span>
                {addr.formatted}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                className="flex-shrink-0 text-gray-400 hover:text-red-500"
                aria-label="Remove address"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Single add */}
      {!bulkMode && !isAtMax && (
        <div className="flex gap-2">
          <div className="flex-1">
            <AddressInput
              label=""
              placeholder="Add an address..."
              value={pendingAdd}
              onChange={setPendingAdd}
            />
          </div>
          <button
            type="button"
            onClick={() => handleAdd(pendingAdd)}
            className="btn-secondary mt-0 self-end"
            disabled={!pendingAdd}
          >
            Add
          </button>
        </div>
      )}

      {isAtMax && (
        <p className="text-xs text-amber-700">Maximum of {maxCount} addresses reached.</p>
      )}

      {/* Bulk paste */}
      {bulkMode && (
        <div className="space-y-2">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'One address per line:\n123 Main St, Pittsburgh, PA 15216\n456 Oak Ave, Pittsburgh, PA 15217'}
            rows={5}
            className="input font-mono text-xs"
          />
          {bulkErrors.length > 0 && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
              <p className="font-semibold">Could not geocode:</p>
              <ul className="mt-1 list-disc pl-4">
                {bulkErrors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={handleBulkPaste}
            disabled={bulkLoading || !bulkText.trim()}
            className="btn-primary w-full"
          >
            {bulkLoading ? 'Geocoding...' : 'Add All Addresses'}
          </button>
        </div>
      )}
    </div>
  );
}
