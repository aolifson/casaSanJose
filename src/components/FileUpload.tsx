import { useRef, useState } from 'react';
import type { GeocodingProgress } from '../types';
import { parseCSV, parseXML } from '../utils/fileParser';
import { geocodeAddressBatch } from '../utils/maps';
import type { GeocodedAddress } from '../types';

interface FileUploadProps {
  onAddressesLoaded: (addresses: GeocodedAddress[]) => void;
}

type UploadState = 'idle' | 'parsed' | 'geocoding' | 'done' | 'error';
type InputTab = 'file' | 'paste';

export default function FileUpload({ onAddressesLoaded }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [tab, setTab] = useState<InputTab>('file');
  const [pasteText, setPasteText] = useState('');
  const [rawAddresses, setRawAddresses] = useState<string[]>([]);
  const [progress, setProgress] = useState<GeocodingProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    setState('idle');
    setErrorMsg('');
    setRawAddresses([]);

    const text = await file.text();
    let parsed: string[] = [];

    try {
      if (file.name.endsWith('.xml') || file.type === 'text/xml' || file.type === 'application/xml') {
        parsed = parseXML(text);
      } else {
        parsed = parseCSV(text);
      }
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to parse file.');
      return;
    }

    if (parsed.length === 0) {
      setState('error');
      setErrorMsg('No addresses found in the file. Check the format and try again.');
      return;
    }

    setRawAddresses(parsed);
    setState('parsed');
  };

  const handleGeocode = async () => {
    setState('geocoding');
    setProgress({ total: rawAddresses.length, completed: 0, failed: [] });

    try {
      const geocoded = await geocodeAddressBatch(rawAddresses, setProgress);
      setState('done');
      onAddressesLoaded(geocoded);
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Geocoding failed.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handlePasteSubmit = () => {
    const lines = pasteText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.toLowerCase() !== 'address');
    if (lines.length === 0) {
      setState('error');
      setErrorMsg('No addresses found. Enter one address per line.');
      return;
    }
    setRawAddresses(lines);
    setState('parsed');
  };

  const handleReset = () => {
    setState('idle');
    setRawAddresses([]);
    setProgress(null);
    setErrorMsg('');
    setPasteText('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-gray-600">
        Delivery Address Pool
      </label>

      {state === 'idle' && (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            <button
              type="button"
              onClick={() => setTab('file')}
              className={`flex-1 py-2 text-xs font-medium transition ${
                tab === 'file'
                  ? 'bg-white text-amber-700 border-b-2 border-amber-500'
                  : 'bg-gray-50 text-gray-500 hover:text-gray-700'
              }`}
            >
              Upload File
            </button>
            <button
              type="button"
              onClick={() => setTab('paste')}
              className={`flex-1 py-2 text-xs font-medium transition ${
                tab === 'paste'
                  ? 'bg-white text-amber-700 border-b-2 border-amber-500'
                  : 'bg-gray-50 text-gray-500 hover:text-gray-700'
              }`}
            >
              Paste / Type
            </button>
          </div>

          {tab === 'file' ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer p-8 text-center transition ${
                isDragging ? 'bg-amber-50' : 'bg-white hover:bg-gray-50'
              }`}
            >
              <div className="text-3xl">📄</div>
              <p className="mt-2 text-sm font-medium text-gray-600">
                Drop a CSV or XML file here, or click to browse
              </p>
              <p className="mt-1 text-xs text-gray-400">
                One address per row — supports multi-column formats too
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xml,text/csv,text/xml,application/xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>
          ) : (
            <div className="bg-white p-3 space-y-2">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={`One address per line, e.g.\n1418 Beechview Ave, Pittsburgh, PA 15216\n623 Broadway Ave, Pittsburgh, PA 15216`}
                rows={7}
                className="input w-full resize-none font-mono text-xs"
              />
              <button
                type="button"
                onClick={handlePasteSubmit}
                disabled={!pasteText.trim()}
                className="btn-primary w-full"
              >
                Use These Addresses
              </button>
            </div>
          )}
        </div>
      )}

      {state === 'parsed' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">
              Found <span className="text-amber-700 font-bold">{rawAddresses.length}</span> addresses
            </p>
            <button type="button" onClick={handleReset} className="text-xs text-gray-400 hover:text-gray-600">
              Remove file
            </button>
          </div>
          <ul className="max-h-40 overflow-y-auto space-y-1 text-xs text-gray-600">
            {rawAddresses.slice(0, 10).map((addr, i) => (
              <li key={i} className="truncate rounded bg-white px-2 py-1 shadow-sm">{addr}</li>
            ))}
            {rawAddresses.length > 10 && (
              <li className="px-2 py-1 text-gray-400">...and {rawAddresses.length - 10} more</li>
            )}
          </ul>
          <button type="button" onClick={handleGeocode} className="btn-primary mt-3 w-full">
            Confirm & Geocode Addresses
          </button>
        </div>
      )}

      {state === 'geocoding' && progress && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="mb-2 text-sm font-medium text-gray-700">
            Geocoding addresses... {progress.completed}/{progress.total}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-amber-500 transition-all"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
          {progress.failed.length > 0 && (
            <p className="mt-2 text-xs text-red-600">
              {progress.failed.length} address(es) could not be found
            </p>
          )}
        </div>
      )}

      {state === 'done' && progress && (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-800">
            ✓ {progress.completed - progress.failed.length} addresses loaded
            {progress.failed.length > 0 && (
              <span className="ml-1 text-red-600">({progress.failed.length} failed)</span>
            )}
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
