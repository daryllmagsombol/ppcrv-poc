'use client';

interface ScanProgressProps {
  scanned: number;
  total: number;
  currentScanning: number;
}

export function ScanProgress({ scanned, total, currentScanning }: ScanProgressProps) {
  return (
    <div className="flex items-center justify-center gap-4">
      {Array.from({ length: total }, (_, i) => {
        const slot = i + 1;
        const isDone = slot <= scanned;
        const isCurrent = slot === currentScanning && scanned < total;
        return (
          <div
            key={slot}
            className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-lg font-bold transition-all
              ${isDone ? 'border-green-500 bg-green-50 text-green-700' : ''}
              ${isCurrent ? 'border-[#C41E3A] bg-red-50 text-[#C41E3A] animate-pulse' : ''}
              ${!isDone && !isCurrent ? 'border-gray-300 bg-gray-50 text-gray-400' : ''}
            `}
          >
            {isDone ? '✓' : slot}
          </div>
        );
      })}
    </div>
  );
}
