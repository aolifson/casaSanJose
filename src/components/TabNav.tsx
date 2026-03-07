import type { AppMode } from '../types';

interface TabNavProps {
  activeMode: AppMode;
  onChange: (mode: AppMode) => void;
}

export default function TabNav({ activeMode, onChange }: TabNavProps) {
  return (
    <div className="flex rounded-xl bg-gray-100 p-1">
      {(['coordinator', 'volunteer'] as AppMode[]).map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
            activeMode === mode
              ? 'bg-white text-amber-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {mode === 'coordinator' ? '📋 Coordinator' : '🚗 Volunteer'}
        </button>
      ))}
    </div>
  );
}
