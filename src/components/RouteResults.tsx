import type { RouteResult, VolunteerRouteResult } from '../types';
import RouteCard from './RouteCard';

interface VolunteerResultsProps {
  mode: 'coordinator';
  results: VolunteerRouteResult[];
  onReset: () => void;
}

interface SingleResultProps {
  mode: 'volunteer';
  result: RouteResult;
  onReset: () => void;
}

type RouteResultsProps = VolunteerResultsProps | SingleResultProps;

export default function RouteResults(props: RouteResultsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">
          {props.mode === 'coordinator'
            ? `${(props as VolunteerResultsProps).results.length} Routes Generated`
            : 'Your Route'}
        </h2>
        <button type="button" onClick={props.onReset} className="btn-secondary text-xs">
          ← Start Over
        </button>
      </div>

      {props.mode === 'volunteer' ? (
        <RouteCard title="Your Delivery Route" result={(props as SingleResultProps).result} />
      ) : (
        <div className="space-y-3">
          {(props as VolunteerResultsProps).results.map(({ volunteer, route, error }, i) =>
            route ? (
              <RouteCard
                key={volunteer.id}
                title={volunteer.name || `Volunteer ${i + 1}`}
                result={route}
                phone={volunteer.phone}
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
      )}
    </div>
  );
}
