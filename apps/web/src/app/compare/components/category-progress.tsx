'use client';

interface CategoryProgressProps {
  /** Set of category strings already captured (e.g., 'NATIONAL', 'PARTY LIST', 'Metadata') */
  captured: Set<string>;
  /** Total number of QR codes captured (including Unknown ones) */
  totalCount: number;
}

const KNOWN_CATEGORIES = ['NATIONAL', 'PARTY LIST', 'Metadata'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  NATIONAL: 'National',
  'PARTY LIST': 'Party List',
  Metadata: 'Metadata',
};

export function CategoryProgress({ captured, totalCount }: CategoryProgressProps) {
  const allCaptured = KNOWN_CATEGORIES.every(c => captured.has(c));

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center justify-center gap-3">
        {KNOWN_CATEGORIES.map(cat => {
          const isDone = captured.has(cat);
          return (
            <div
              key={cat}
              className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-all
                ${isDone
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-300 bg-gray-50 text-gray-400'
                }`}
            >
              <span>{CATEGORY_LABELS[cat] || cat}</span>
              {isDone && <span className="text-green-600">✓</span>}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-gray-500">
        {allCaptured
          ? `✓ All QR codes captured (${totalCount})`
          : `${totalCount} QR code${totalCount === 1 ? '' : 's'} captured`
        }
      </p>
    </div>
  );
}
