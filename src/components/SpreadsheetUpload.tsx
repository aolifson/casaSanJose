import { useRef, useState } from 'react';
import type {
  GeocodedAddress,
  GeocodingProgress,
  PriorDeliveryAssignment,
  VolunteerEntry,
} from '../types';
import { parseDeliverySheetCsv } from '../utils/fileParser';
import { geocodeNeighborhood, geocodeZipCode } from '../utils/maps';

interface SpreadsheetUploadProps {
  onSheetLoaded: (payload: {
    deliveries: GeocodedAddress[];
    volunteers: VolunteerEntry[];
    priorAssignments: PriorDeliveryAssignment[];
  }) => void;
}

type UploadState = 'idle' | 'parsed' | 'geocoding' | 'done' | 'error';

async function geocodeFixedList(
  labels: string[],
  geocodeFn: (value: string) => Promise<GeocodedAddress>,
  onProgress: (progress: GeocodingProgress) => void
): Promise<Array<GeocodedAddress | null>> {
  const results: Array<GeocodedAddress | null> = new Array(labels.length).fill(null);
  const failed: string[] = [];

  onProgress({ total: labels.length, completed: 0, failed });

  for (let index = 0; index < labels.length; index++) {
    try {
      results[index] = await geocodeFn(labels[index]);
    } catch {
      failed.push(labels[index]);
    }

    onProgress({
      total: labels.length,
      completed: index + 1,
      failed: [...failed],
    });
  }

  return results;
}

export default function SpreadsheetUpload({ onSheetLoaded }: SpreadsheetUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [pasteText, setPasteText] = useState('');
  const [summary, setSummary] = useState<{
    deliveryZipCodes: string[];
    priorAssignments: PriorDeliveryAssignment[];
    drivers: { name: string; neighborhood: string }[];
  } | null>(null);
  const [progress, setProgress] = useState<GeocodingProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const parseSheet = (text: string) => {
    setState('idle');
    setErrorMsg('');
    setProgress(null);

    try {
      const parsed = parseDeliverySheetCsv(text);
      setSummary(parsed);
      setState('parsed');
    } catch (e) {
      setSummary(null);
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to parse spreadsheet.');
    }
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    parseSheet(text);
  };

  const handleGeocode = async () => {
    if (!summary) return;

    const total = summary.deliveryZipCodes.length + summary.drivers.length;
    setState('geocoding');
    setProgress({ total, completed: 0, failed: [] });

    try {
      const zipResults = await geocodeFixedList(summary.deliveryZipCodes, geocodeZipCode, (zipProgress) => {
        setProgress({
          total,
          completed: zipProgress.completed,
          failed: [...zipProgress.failed],
        });
      });

      const volunteerHomes = await geocodeFixedList(
        summary.drivers.map((driver) => driver.neighborhood),
        geocodeNeighborhood,
        (driverProgress) => {
          setProgress((current) => ({
            total,
            completed: summary.deliveryZipCodes.length + driverProgress.completed,
            failed: [
              ...(current?.failed.filter((entry) => !summary.drivers.some((driver) => driver.neighborhood === entry)) ?? []),
              ...driverProgress.failed,
            ],
          }));
        }
      );

      const volunteers: VolunteerEntry[] = summary.drivers.map((driver, index) => {
        const homeAddress = volunteerHomes[index] ?? null;
        return {
          id: crypto.randomUUID(),
          name: driver.name,
          phone: '',
          homeAddress,
          homeNeighborhood: driver.neighborhood,
          homeZipCode: homeAddress?.postalCode,
          numStops: 0,
        };
      });

      onSheetLoaded({
        deliveries: zipResults.filter((value): value is GeocodedAddress => value !== null),
        volunteers,
        priorAssignments: summary.priorAssignments,
      });

      setState('done');
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to geocode spreadsheet data.');
    }
  };

  const handleReset = () => {
    setState('idle');
    setSummary(null);
    setProgress(null);
    setErrorMsg('');
    setPasteText('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-gray-600">
        Weekly Spreadsheet Import
      </label>

      {state === 'idle' && (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer border-b border-gray-200 p-6 text-center transition ${
              isDragging ? 'bg-amber-50' : 'bg-white hover:bg-gray-50'
            }`}
          >
            <div className="text-3xl">🗂️</div>
            <p className="mt-2 text-sm font-medium text-gray-600">
              Drop the April/March tab CSV here, or click to browse
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Export the Google Sheet tab as CSV. This keeps ZIPs, last-week assignments, and driver neighborhoods.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>

          <div className="bg-gray-50 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-600">Or paste the exported CSV text</p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste the April or March tab CSV export here..."
              rows={6}
              className="input w-full resize-none font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => parseSheet(pasteText)}
              disabled={!pasteText.trim()}
              className="btn-primary w-full"
            >
              Parse Weekly Sheet
            </button>
          </div>
        </div>
      )}

      {state === 'parsed' && summary && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">
              Found <span className="font-bold text-amber-700">{summary.deliveryZipCodes.length}</span> delivery ZIPs,{' '}
              <span className="font-bold text-amber-700">{summary.drivers.length}</span> drivers, and{' '}
              <span className="font-bold text-amber-700">{summary.priorAssignments.length}</span> prior assignments
            </p>
            <button type="button" onClick={handleReset} className="text-xs text-gray-400 hover:text-gray-600">
              Remove sheet
            </button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Routes will be approximate until the exact delivery addresses are added later, because the sheet only contains ZIP codes at this stage.
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">This Week ZIPs</p>
              <ul className="max-h-28 space-y-1 overflow-y-auto text-xs text-gray-600">
                {summary.deliveryZipCodes.slice(0, 10).map((zipCode, index) => (
                  <li key={`${zipCode}-${index}`} className="rounded bg-white px-2 py-1 shadow-sm">
                    {zipCode}
                  </li>
                ))}
                {summary.deliveryZipCodes.length > 10 && (
                  <li className="px-2 py-1 text-gray-400">...and {summary.deliveryZipCodes.length - 10} more</li>
                )}
              </ul>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Drivers</p>
              <ul className="max-h-28 space-y-1 overflow-y-auto text-xs text-gray-600">
                {summary.drivers.map((driver) => (
                  <li key={driver.name} className="rounded bg-white px-2 py-1 shadow-sm">
                    {driver.name} · {driver.neighborhood}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <button type="button" onClick={handleGeocode} className="btn-primary w-full">
            Confirm & Geocode ZIPs / Neighborhoods
          </button>
        </div>
      )}

      {state === 'geocoding' && progress && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="mb-2 text-sm font-medium text-gray-700">
            Geocoding ZIPs and neighborhoods... {progress.completed}/{progress.total}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-amber-500 transition-all"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
          {progress.failed.length > 0 && (
            <p className="mt-2 text-xs text-red-600">
              {progress.failed.length} location(s) could not be matched cleanly
            </p>
          )}
        </div>
      )}

      {state === 'done' && summary && (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-800">
            ✓ Weekly sheet loaded for {summary.drivers.length} drivers
          </p>
          <button type="button" onClick={handleReset} className="text-xs text-gray-500 hover:underline">
            Replace
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{errorMsg}</p>
          <button type="button" onClick={handleReset} className="mt-2 text-xs text-red-500 hover:underline">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
