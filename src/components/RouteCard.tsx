import { useState } from 'react';
import type { RouteResult } from '../types';
import MapView from './MapView';

interface RouteCardProps {
  title: string;
  result: RouteResult;
  phone?: string;
  defaultExpanded?: boolean;
}

export default function RouteCard({ title, result, phone, defaultExpanded = true }: RouteCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const smsBody = [
    `Your delivery route (${result.totalDurationMinutes} min, ${result.totalDistanceMiles} mi):`,
    ...result.stops.map((s) => `${s.order}. ${s.label}: ${s.address.formatted}`),
    '',
    result.googleMapsUrl,
  ].join('\n');

  const smsHref = phone
    ? `sms:${phone.replace(/\D/g, '')}?body=${encodeURIComponent(smsBody)}`
    : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.googleMapsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text in a temporary input
      const el = document.createElement('textarea');
      el.value = result.googleMapsUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-gray-50"
      >
        <div>
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {result.stops.filter((s) => !s.isFixed).length} deliveries ·{' '}
            {result.totalDurationMinutes} min · {result.totalDistanceMiles} mi
          </p>
        </div>
        <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-4">
          {/* Map */}
          <MapView result={result} />

          {/* Stop list */}
          <ol className="space-y-1">
            {result.stops.map((stop) => (
              <li key={`${stop.order}-${stop.address.formatted}`} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                    stop.isFixed ? 'bg-gray-500' : 'bg-amber-600'
                  }`}
                >
                  {stop.order}
                </span>
                <div>
                  <p className="font-medium text-gray-700">{stop.label}</p>
                  <p className="text-xs text-gray-500">{stop.address.formatted}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={result.googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-primary flex-1"
            >
              Open in Google Maps ↗
            </a>
            <button
              type="button"
              onClick={handleCopy}
              className="btn-secondary flex-1"
            >
              {copied ? '✓ Copied!' : 'Copy Route Link'}
            </button>
            {smsHref && (
              <a href={smsHref} className="btn-secondary flex-1 text-center">
                📱 Text Route
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
