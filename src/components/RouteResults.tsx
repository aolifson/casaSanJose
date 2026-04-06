import { useState } from 'react';
import type { RouteResult, VolunteerRouteResult, WeeklySheetContext } from '../types';
import RouteCard from './RouteCard';
import { sendTextBelt } from '../utils/sms';
import { exportWeeklySheetWorkbook } from '../utils/weeklySheetExport';

interface VolunteerResultsProps {
  mode: 'coordinator';
  results: VolunteerRouteResult[];
  textBeltKey?: string;
  weeklySheet?: WeeklySheetContext;
  onReset: () => void;
}

interface SingleResultProps {
  mode: 'volunteer';
  result: RouteResult;
  onReset: () => void;
}

type RouteResultsProps = VolunteerResultsProps | SingleResultProps;

export default function RouteResults(props: RouteResultsProps) {
  const [sendAllState, setSendAllState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [sendAllSummary, setSendAllSummary] = useState('');
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'done'>('idle');

  const handleSendAll = async () => {
    if (props.mode !== 'coordinator') return;
    const { results, textBeltKey } = props as VolunteerResultsProps;
    if (!textBeltKey) return;

    const targets = results.filter(
      ({ volunteer, route }) => volunteer.phone && route,
    );
    if (targets.length === 0) return;

    setSendAllState('sending');
    let sent = 0;
    let failed = 0;

    for (const { volunteer, route } of targets) {
      const smsBody = [
        `Your delivery route (${route!.totalDurationMinutes} min, ${route!.totalDistanceMiles} mi):`,
        ...route!.stops.map((s) => `${s.order}. ${s.label}: ${s.address.formatted}`),
        '',
        route!.googleMapsUrl,
      ].join('\n');

      try {
        const res = await sendTextBelt(volunteer.phone!, smsBody, textBeltKey);
        if (res.success) sent++; else failed++;
      } catch {
        failed++;
      }
    }

    setSendAllState('done');
    setSendAllSummary(
      failed === 0
        ? `✓ ${sent} text${sent !== 1 ? 's' : ''} sent`
        : `${sent} sent, ${failed} failed`,
    );
  };

  if (props.mode === 'coordinator') {
    const { results, textBeltKey, weeklySheet, onReset } = props as VolunteerResultsProps;
    const phoneCount = results.filter((r) => r.volunteer.phone && r.route).length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">
            {results.length} Routes Generated
          </h2>
          <div className="flex items-center gap-2">
            {weeklySheet && (
              <button
                type="button"
                onClick={async () => {
                  setExportState('exporting');
                  try {
                    await exportWeeklySheetWorkbook(results, weeklySheet);
                    setExportState('done');
                  } catch {
                    setExportState('idle');
                  }
                }}
                disabled={exportState === 'exporting'}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                {exportState === 'exporting'
                  ? 'Preparing Export...'
                  : exportState === 'done'
                  ? 'Downloaded Export'
                  : 'Download Clean Sheet'}
              </button>
            )}
            {textBeltKey && phoneCount > 0 && (
              <button
                type="button"
                onClick={handleSendAll}
                disabled={sendAllState === 'sending' || sendAllState === 'done'}
                className="btn-primary text-xs py-1.5 px-3"
              >
                {sendAllState === 'sending'
                  ? 'Sending...'
                  : sendAllState === 'done'
                  ? sendAllSummary
                  : `Send All ${phoneCount} Text${phoneCount !== 1 ? 's' : ''}`}
              </button>
            )}
            <button type="button" onClick={onReset} className="btn-secondary text-xs">
              ← Start Over
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {results.map(({ volunteer, route, error }, i) =>
            route ? (
              <RouteCard
                key={volunteer.id}
                title={volunteer.name || `Volunteer ${i + 1}`}
                result={route}
                phone={volunteer.phone}
                textBeltKey={textBeltKey}
                defaultExpanded={i === 0}
              />
            ) : (
              <div key={volunteer.id} className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-700">
                  {volunteer.name || `Volunteer ${i + 1}`} — Route failed
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-red-600">{error}</p>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">Your Route</h2>
        <button type="button" onClick={props.onReset} className="btn-secondary text-xs">
          ← Start Over
        </button>
      </div>
      <RouteCard title="Your Delivery Route" result={(props as SingleResultProps).result} />
    </div>
  );
}
