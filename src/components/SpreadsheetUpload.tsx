import { useRef, useState } from 'react';
import type {
  GeocodedAddress,
  GeocodingProgress,
  VolunteerEntry,
  WeeklySheetContext,
  WeeklySheetSource,
} from '../types';
import { parseDeliverySheetCsv } from '../utils/fileParser';
import { loadGoogleSheetWorkbook, workbookSheetToCsv } from '../utils/googleSheets';
import { geocodeNeighborhood, geocodeZipCode } from '../utils/maps';

interface SpreadsheetUploadProps {
  onSheetLoaded: (payload: {
    deliveries: GeocodedAddress[];
    volunteers: VolunteerEntry[];
    weeklySheet: WeeklySheetContext;
  }) => void;
}

type UploadState = 'idle' | 'parsed' | 'geocoding' | 'done' | 'error';
type ImportMode = 'google-sheet' | 'file' | 'paste';

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
  const workbookRef = useRef<Awaited<ReturnType<typeof loadGoogleSheetWorkbook>> | null>(null);

  const [state, setState] = useState<UploadState>('idle');
  const [importMode, setImportMode] = useState<ImportMode>('google-sheet');
  const [pasteText, setPasteText] = useState('');
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [availableTabs, setAvailableTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState('');
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [summary, setSummary] = useState<WeeklySheetContext | null>(null);
  const [progress, setProgress] = useState<GeocodingProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const parseSheet = (text: string, source?: WeeklySheetSource) => {
    setState('idle');
    setErrorMsg('');
    setProgress(null);

    try {
      const parsed = parseDeliverySheetCsv(text);
      setSummary({
        ...parsed,
        source,
      });
      setState('parsed');
    } catch (e) {
      setSummary(null);
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to parse spreadsheet.');
    }
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    parseSheet(text, { workbookName: file.name, tabName: file.name });
  };

  const handleLoadTabs = async () => {
    setLoadingTabs(true);
    setErrorMsg('');

    try {
      const workbookInfo = await loadGoogleSheetWorkbook(googleSheetUrl);
      workbookRef.current = workbookInfo;
      setAvailableTabs(workbookInfo.tabs);
      setSelectedTab(workbookInfo.tabs[0] ?? '');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to load Google Sheet.');
      setAvailableTabs([]);
      setSelectedTab('');
      workbookRef.current = null;
    } finally {
      setLoadingTabs(false);
    }
  };

  const handleParseSelectedTab = async () => {
    const workbookInfo = workbookRef.current;
    if (!workbookInfo || !selectedTab) return;

    try {
      const csvText = await workbookSheetToCsv(workbookInfo.workbook, selectedTab);
      parseSheet(csvText, {
        spreadsheetId: workbookInfo.spreadsheetId,
        spreadsheetUrl: workbookInfo.spreadsheetUrl,
        workbookName: workbookInfo.workbookName,
        tabName: selectedTab,
      });
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to read the selected tab.');
    }
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
        weeklySheet: summary,
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
    setGoogleSheetUrl('');
    setAvailableTabs([]);
    setSelectedTab('');
    workbookRef.current = null;
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-gray-600">
        Weekly Spreadsheet Import
      </label>

      {state === 'idle' && (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200">
            {([
              ['google-sheet', 'Google Sheet'],
              ['file', 'Upload CSV'],
              ['paste', 'Paste CSV'],
            ] as Array<[ImportMode, string]>).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setImportMode(mode)}
                className={`flex-1 py-2 text-xs font-medium transition ${
                  importMode === mode
                    ? 'bg-white text-amber-700 border-b-2 border-amber-500'
                    : 'bg-gray-50 text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {importMode === 'google-sheet' && (
            <div className="bg-white p-4 space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">
                  Google Sheet URL or spreadsheet ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={googleSheetUrl}
                    onChange={(e) => setGoogleSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleLoadTabs}
                    disabled={!googleSheetUrl.trim() || loadingTabs}
                    className="btn-primary whitespace-nowrap"
                  >
                    {loadingTabs ? 'Loading...' : 'Load Tabs'}
                  </button>
                </div>
              </div>

              {availableTabs.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">
                    Tab to import
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={selectedTab}
                      onChange={(e) => setSelectedTab(e.target.value)}
                      className="input flex-1"
                    >
                      {availableTabs.map((tabName) => (
                        <option key={tabName} value={tabName}>{tabName}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => { void handleParseSelectedTab(); }}
                      disabled={!selectedTab}
                      className="btn-primary whitespace-nowrap"
                    >
                      Parse Tab
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">
                    Use the same March/April-style tab you already maintain today.
                  </p>
                </div>
              )}
            </div>
          )}

          {importMode === 'file' && (
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
              className={`cursor-pointer p-8 text-center transition ${
                isDragging ? 'bg-amber-50' : 'bg-white hover:bg-gray-50'
              }`}
            >
              <div className="text-3xl">🗂️</div>
              <p className="mt-2 text-sm font-medium text-gray-600">
                Drop the weekly tab CSV here, or click to browse
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Export the Google Sheet tab as CSV if you want an offline fallback.
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
          )}

          {importMode === 'paste' && (
            <div className="bg-gray-50 p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600">Paste the exported CSV text</p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste the March/April tab CSV export here..."
                rows={6}
                className="input w-full resize-none font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => parseSheet(pasteText, { workbookName: 'Pasted CSV', tabName: 'Pasted CSV' })}
                disabled={!pasteText.trim()}
                className="btn-primary w-full"
              >
                Parse Weekly Sheet
              </button>
            </div>
          )}
        </div>
      )}

      {errorMsg && state === 'idle' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{errorMsg}</p>
        </div>
      )}

      {state === 'parsed' && summary && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">
                Found <span className="font-bold text-amber-700">{summary.deliveryZipCodes.length}</span> delivery ZIPs,{' '}
                <span className="font-bold text-amber-700">{summary.drivers.length}</span> drivers, and{' '}
                <span className="font-bold text-amber-700">{summary.priorAssignments.length}</span> prior assignments
              </p>
              {summary.source?.tabName && (
                <p className="mt-1 text-xs text-gray-500">
                  Source tab: <span className="font-medium">{summary.source.tabName}</span>
                </p>
              )}
            </div>
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
          <div>
            <p className="text-sm font-medium text-green-800">
              ✓ Weekly sheet loaded for {summary.drivers.length} drivers
            </p>
            {summary.source?.tabName && (
              <p className="text-xs text-green-700">
                Ready from {summary.source.tabName}
              </p>
            )}
          </div>
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
