import { useState } from 'react';

interface ApiKeyInputProps {
  onKeySubmit: (key: string) => void;
  title?: string;
  description?: string;
  linkText?: string;
  linkHref?: string;
  placeholder?: string;
}

export default function ApiKeyInput({
  onKeySubmit,
  title = 'Google Maps API Key Required',
  description = 'To use this app, you need a free Google Maps API key.',
  linkText = 'Learn how to get one →',
  linkHref = 'https://developers.google.com/maps/get-started',
  placeholder = 'AIza...',
}: ApiKeyInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) onKeySubmit(value.trim());
  };

  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <div className="mb-4 text-4xl">🗺️</div>
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      <p className="mb-4 text-sm text-gray-500">
        {description}{' '}
        <a
          href={linkHref}
          target="_blank"
          rel="noreferrer"
          className="text-amber-600 underline hover:text-amber-700"
        >
          {linkText}
        </a>
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="input flex-1"
        />
        <button type="submit" className="btn-primary" disabled={!value.trim()}>
          Save
        </button>
      </form>
      <p className="mt-3 text-xs text-gray-400">
        Your key is stored only in your browser and never sent to any server.
      </p>
    </div>
  );
}
