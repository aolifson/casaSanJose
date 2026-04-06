import { useEffect } from 'react';
import type { GeocodedAddress, VolunteerEntry } from '../types';
import AddressInput from './AddressInput';

interface VolunteerListProps {
  numVolunteers: number;
  onNumVolunteersChange: (n: number) => void;
  volunteers: VolunteerEntry[];
  onChange: (volunteers: VolunteerEntry[]) => void;
  totalPoolSize: number;
  locationMode?: 'address' | 'neighborhood';
}

function makeVolunteer(index: number): VolunteerEntry {
  return {
    id: crypto.randomUUID(),
    name: `Volunteer ${index + 1}`,
    homeAddress: null,
    homeNeighborhood: '',
    numStops: 0,
  };
}

/**
 * Calculate how many stops each volunteer gets for an even split.
 * Remainder is spread across the first N volunteers so the max difference
 * between any two volunteers is exactly 1 stop.
 * e.g. 30 addresses / 4 volunteers → [8, 8, 7, 7] not [7, 7, 7, 9]
 */
export function calcEvenSplit(poolSize: number, numVolunteers: number): number[] {
  if (numVolunteers <= 0 || poolSize <= 0) return Array(numVolunteers).fill(0);
  const base = Math.floor(poolSize / numVolunteers);
  const remainder = poolSize % numVolunteers;
  // First `remainder` volunteers get one extra stop
  return Array.from({ length: numVolunteers }, (_, i) => base + (i < remainder ? 1 : 0));
}

export default function VolunteerList({
  numVolunteers,
  onNumVolunteersChange,
  volunteers,
  onChange,
  totalPoolSize,
  locationMode = 'address',
}: VolunteerListProps) {
  // Sync volunteers array length to numVolunteers
  useEffect(() => {
    if (volunteers.length < numVolunteers) {
      const extras = Array.from(
        { length: numVolunteers - volunteers.length },
        (_, i) => makeVolunteer(volunteers.length + i)
      );
      onChange([...volunteers, ...extras]);
    } else if (volunteers.length > numVolunteers) {
      onChange(volunteers.slice(0, numVolunteers));
    }
  }, [numVolunteers]); // eslint-disable-line react-hooks/exhaustive-deps

  const splits = calcEvenSplit(totalPoolSize, numVolunteers);
  const stopsEach = splits[0] ?? 0;
  const lastGetsExtra = totalPoolSize > 0 && totalPoolSize % numVolunteers !== 0;

  const updateVolunteer = (id: string, patch: Partial<VolunteerEntry>) => {
    onChange(volunteers.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  };

  return (
    <div className="space-y-4">
      {/* Number of volunteers + split preview */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Number of Volunteers
          </label>
          <input
            type="number"
            value={numVolunteers}
            onChange={(e) =>
              onNumVolunteersChange(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))
            }
            min={1}
            max={20}
            className="input"
          />
        </div>

        {totalPoolSize > 0 && stopsEach > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 leading-snug flex-shrink-0">
            <span className="font-bold">{stopsEach}</span> stops each
            {lastGetsExtra && (
              <span className="block text-amber-600">
                last gets {splits[splits.length - 1]}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Per-volunteer rows */}
      <div className="space-y-3">
        {volunteers.slice(0, numVolunteers).map((volunteer, idx) => (
          <VolunteerRow
            key={volunteer.id}
            index={idx}
            volunteer={volunteer}
            stops={splits[idx] ?? 0}
            locationMode={locationMode}
            onUpdate={(patch) => updateVolunteer(volunteer.id, patch)}
          />
        ))}
      </div>
    </div>
  );
}

interface VolunteerRowProps {
  index: number;
  volunteer: VolunteerEntry;
  stops: number;
  locationMode: 'address' | 'neighborhood';
  onUpdate: (patch: Partial<VolunteerEntry>) => void;
}

function VolunteerRow({ index, volunteer, stops, locationMode, onUpdate }: VolunteerRowProps) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-amber-700">
          Volunteer {index + 1}
          {stops > 0 && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
              {stops} stops
            </span>
          )}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Name <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={volunteer.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder={`Volunteer ${index + 1}`}
            className="input"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Phone <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="tel"
            value={volunteer.phone ?? ''}
            onChange={(e) => onUpdate({ phone: e.target.value })}
            placeholder="412-555-0100"
            className="input"
          />
        </div>
      </div>

      {locationMode === 'neighborhood' ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Home Neighborhood <span className="text-gray-400">(used to find an approximate home ZIP)</span>
          </label>
          <input
            type="text"
            value={volunteer.homeNeighborhood ?? ''}
            onChange={(e) =>
              onUpdate({
                homeNeighborhood: e.target.value,
                homeAddress: null,
                homeZipCode: undefined,
              })
            }
            placeholder="Uptown, Penn Hills, Mt. Lebo..."
            className="input"
          />
          {(volunteer.homeZipCode || volunteer.homeAddress?.formatted) && (
            <p className="mt-1 text-xs text-gray-500">
              {volunteer.homeZipCode ? `Approx ZIP ${volunteer.homeZipCode}` : 'Location matched'}{' '}
              {volunteer.homeAddress?.formatted ? `· ${volunteer.homeAddress.formatted}` : ''}
            </p>
          )}
        </div>
      ) : (
        <AddressInput
          label="Home Address (optional — leave blank to start/end at Casa San Jose)"
          placeholder="Volunteer's home address..."
          value={volunteer.homeAddress}
          onChange={(addr: GeocodedAddress | null) => onUpdate({ homeAddress: addr })}
        />
      )}
    </div>
  );
}
