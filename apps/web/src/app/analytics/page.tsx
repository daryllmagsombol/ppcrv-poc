'use client';

import { useEffect } from 'react';
import { useAnalytics } from './hooks/use-analytics';

export default function AnalyticsPage() {
  const {
    loading, error, geoSelection,
    regionStatuses, provinceStatuses, cityStatuses,
    voteShare, undervotes,
    loadGeographyStatus, selectRegion, selectProvince, selectCity, goToNational,
  } = useAnalytics();

  useEffect(() => {
    loadGeographyStatus();
  }, [loadGeographyStatus]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 font-serif text-2xl font-bold text-[#1B3A5C]">
        Election Analytics
      </h1>

      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-600">
        <button onClick={goToNational} className="hover:text-[#1B3A5C] hover:underline">
          National
        </button>
        {geoSelection.region && (
          <>
            <span>/</span>
            <span className="font-medium text-[#1B3A5C]">{geoSelection.region}</span>
          </>
        )}
        {geoSelection.province && (
          <>
            <span>/</span>
            <span className="font-medium text-[#1B3A5C]">{geoSelection.province}</span>
          </>
        )}
        {geoSelection.city && (
          <>
            <span>/</span>
            <span className="font-medium text-[#1B3A5C]">{geoSelection.city}</span>
          </>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Map View (placeholder) */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 font-serif text-lg font-semibold text-[#1B3A5C]">Map View</h2>
          <div className="flex h-80 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
            Map component will render here
          </div>
          <div className="mt-3 text-xs text-gray-500">
            {geoSelection.level === 'national' && `${regionStatuses.length} regions loaded`}
            {geoSelection.level === 'region' && `${provinceStatuses.length} provinces loaded`}
            {geoSelection.level === 'province' && `${cityStatuses.length} cities loaded`}
          </div>
        </div>

        <div className="space-y-6">
          {/* Vote Share Chart (placeholder) */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 font-serif text-lg font-semibold text-[#1B3A5C]">
              Vote Share {voteShare?.contest && `- ${voteShare.contest}`}
            </h2>
            <div className="flex h-64 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
              {loading ? 'Loading...' : voteShare ? `${voteShare.candidates.length} candidates` : 'Select a geography'}
            </div>
          </div>

          {/* Undervote Panel (placeholder) */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 font-serif text-lg font-semibold text-[#1B3A5C]">
              Under / Over Vote Analysis
            </h2>
            <div className="flex h-32 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
              {loading ? 'Loading...' : undervotes ? `${undervotes.undervoteRate}% undervote rate` : 'Select a geography'}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
