import { useRef, useState, useEffect, useCallback } from 'react';
import { extractAddressesFromImage, fileToBase64 } from '../utils/imageExtractor';
import { geocodeAddressBatch } from '../utils/maps';
import type { GeocodedAddress, GeocodingProgress } from '../types';

interface ImageAddressInputProps {
  onAddressesExtracted: (addresses: GeocodedAddress[]) => void;
  anthropicApiKey: string | null;
  onNeedApiKey: () => void;
}

type State = 'idle' | 'extracting' | 'review' | 'geocoding' | 'done' | 'error';

export default function ImageAddressInput({
  onAddressesExtracted,
  anthropicApiKey,
  onNeedApiKey,
}: ImageAddressInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rawAddresses, setRawAddresses] = useState<string[]>([]);
  const [selectedAddresses, setSelectedAddresses] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<GeocodingProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Listen for Ctrl+V / Cmd+V paste of images
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) processFile(file);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anthropicApiKey]
  );

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const processFile = async (file: File) => {
    if (!anthropicApiKey) {
      onNeedApiKey();
      return;
    }

    setState('extracting');
    setErrorMsg('');
    setRawAddresses([]);

    // Show image preview
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    try {
      const { base64, mimeType } = await fileToBase64(file);
      const addresses = await extractAddressesFromImage(base64, mimeType, anthropicApiKey);

      if (addresses.length === 0) {
        setState('error');
        setErrorMsg('No addresses found in the image. Try a clearer photo of the delivery sheet.');
        return;
      }

      setRawAddresses(addresses);
      setSelectedAddresses(new Set(addresses.map((_, i) => i)));
      setState('review');
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to extract addresses from image.');
    }
  };

  const handleGeocode = async () => {
    const toGeocode = rawAddresses.filter((_, i) => selectedAddresses.has(i));
    if (toGeocode.length === 0) return;

    setState('geocoding');
    setProgress({ total: toGeocode.length, completed: 0, failed: [] });

    try {
      const geocoded = await geocodeAddressBatch(toGeocode, setProgress);
      setState('done');
      onAddressesExtracted(geocoded);
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Geocoding failed.');
    }
  };

  const toggleAddress = (i: number) => {
    setSelectedAddresses((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const reset = () => {
    setState('idle');
    setPreviewUrl(null);
    setRawAddresses([]);
    setSelectedAddresses(new Set());
    setProgress(null);
    setErrorMsg('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) processFile(file);
  };

  if (state === 'idle') {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => {
          if (!anthropicApiKey) { onNeedApiKey(); return; }
          fileInputRef.current?.click();
        }}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${
          isDragging
            ? 'border-purple-400 bg-purple-50'
            : 'border-gray-300 hover:border-purple-400 hover:bg-gray-50'
        }`}
      >
        <div className="text-3xl">📷</div>
        <p className="mt-2 text-sm font-medium text-gray-600">
          Drop a photo, click to browse, or <kbd className="rounded bg-gray-100 px-1 text-xs">Ctrl+V</kbd> to paste
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Claude AI will extract the delivery addresses from your image
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
          }}
        />
      </div>
    );
  }

  if (state === 'extracting') {
    return (
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-5 text-center">
        {previewUrl && (
          <img src={previewUrl} alt="Delivery sheet" className="mx-auto mb-3 max-h-40 rounded-lg object-contain shadow" />
        )}
        <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
        <p className="text-sm font-medium text-purple-700">
          Claude is reading your delivery sheet...
        </p>
      </div>
    );
  }

  if (state === 'review') {
    return (
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-purple-800">
            Found {rawAddresses.length} addresses — select which to add:
          </p>
          <button type="button" onClick={reset} className="text-xs text-gray-400 hover:text-gray-600">
            Cancel
          </button>
        </div>

        {previewUrl && (
          <img src={previewUrl} alt="Delivery sheet" className="max-h-32 rounded-lg object-contain shadow" />
        )}

        <ul className="max-h-52 overflow-y-auto space-y-1">
          {rawAddresses.map((addr, i) => (
            <li
              key={i}
              onClick={() => toggleAddress(i)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
                selectedAddresses.has(i) ? 'bg-white shadow-sm' : 'bg-purple-100 opacity-50'
              }`}
            >
              <span className={`text-base ${selectedAddresses.has(i) ? 'text-purple-600' : 'text-gray-400'}`}>
                {selectedAddresses.has(i) ? '☑' : '☐'}
              </span>
              <span className="text-gray-700">{addr}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={handleGeocode}
          disabled={selectedAddresses.size === 0}
          className="btn-primary w-full"
        >
          Add {selectedAddresses.size} Address{selectedAddresses.size !== 1 ? 'es' : ''}
        </button>
      </div>
    );
  }

  if (state === 'geocoding' && progress) {
    return (
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 space-y-2">
        <p className="text-sm font-medium text-purple-700">
          Geocoding addresses... {progress.completed}/{progress.total}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-purple-200">
          <div
            className="h-2 rounded-full bg-purple-500 transition-all"
            style={{ width: `${(progress.completed / progress.total) * 100}%` }}
          />
        </div>
      </div>
    );
  }

  if (state === 'done' && progress) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-purple-200 bg-purple-50 px-4 py-3">
        <p className="text-sm font-medium text-purple-800">
          ✓ {progress.completed - progress.failed.length} addresses extracted from image
          {progress.failed.length > 0 && (
            <span className="ml-1 text-red-600">({progress.failed.length} failed)</span>
          )}
        </p>
        <button type="button" onClick={reset} className="text-xs text-gray-400 hover:underline">
          Scan another
        </button>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{errorMsg}</p>
        <button type="button" onClick={reset} className="mt-2 text-xs text-red-500 hover:underline">
          Try again
        </button>
      </div>
    );
  }

  return null;
}
