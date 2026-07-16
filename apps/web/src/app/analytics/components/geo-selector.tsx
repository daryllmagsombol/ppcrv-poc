'use client';

import { RegionStatus, ProvinceStatus, CityStatus, GeoSelection } from '../types';

interface GeoSelectorProps {
  loading: boolean;
  geoSelection: GeoSelection;
  regionStatuses: RegionStatus[];
  provinceStatuses: ProvinceStatus[];
  cityStatuses: CityStatus[];
  onSelectRegion: (name: string) => void;
  onSelectProvince: (region: string, province: string) => void;
  onSelectCity: (region: string, province: string, city: string) => void;
}

function Spinner() {
  return (
    <div className="flex items-center gap-2">
      <svg className="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span>Loading...</span>
    </div>
  );
}

function getColor(rate: number): string {
  if (rate >= 80) return '#22c55e';
  if (rate >= 50) return '#eab308';
  if (rate >= 20) return '#f97316';
  return '#ef4444';
}

function SelectorItem({
  name,
  completionRate,
  onClick,
}: {
  name: string;
  completionRate: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left transition-colors hover:border-[#1B3A5C] hover:bg-blue-50 active:bg-blue-100"
    >
      <span
        className="h-10 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: getColor(completionRate) }}
      />
      <span className="flex-1 text-sm font-medium text-gray-800">{name}</span>
      <span
        className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums"
        style={{
          backgroundColor: `${getColor(completionRate)}20`,
          color: getColor(completionRate),
        }}
      >
        {completionRate}%
      </span>
    </button>
  );
}

function Loader() {
  return (
    <div className="py-6 text-center text-sm text-gray-400">
      <Spinner />
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-4 text-center text-sm text-gray-400">{label}</p>;
}

export default function GeoSelector(props: GeoSelectorProps) {
  const { loading, geoSelection, regionStatuses, provinceStatuses, cityStatuses } = props;
  const { onSelectRegion, onSelectProvince, onSelectCity } = props;

  if (geoSelection.level === 'national') {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Select a Region
        </h3>
        <div className="space-y-1.5">
          {loading ? (
            <Loader />
          ) : regionStatuses.length === 0 ? (
            <Empty label="No regions loaded" />
          ) : (
            regionStatuses.map(r => (
              <SelectorItem
                key={r.name}
                name={r.name}
                completionRate={r.completionRate}
                onClick={() => onSelectRegion(r.name)}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  if (geoSelection.level === 'region') {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Select a Province / District
        </h3>
        <div className="space-y-1.5">
          {loading ? (
            <Loader />
          ) : provinceStatuses.length === 0 ? (
            <Empty label="No provinces loaded" />
          ) : (
            provinceStatuses.map(r => (
              <SelectorItem
                key={r.name}
                name={r.name}
                completionRate={r.completionRate}
                onClick={() => geoSelection.region && onSelectProvince(geoSelection.region, r.name)}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  if (geoSelection.level === 'province') {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Select a City / Municipality
        </h3>
        <div className="space-y-1.5">
          {loading ? (
            <Loader />
          ) : cityStatuses.length === 0 ? (
            <Empty label="No cities loaded" />
          ) : (
            cityStatuses.map(r => (
              <SelectorItem
                key={r.name}
                name={r.name}
                completionRate={r.completionRate}
                onClick={() =>
                  geoSelection.region &&
                  geoSelection.province &&
                  onSelectCity(geoSelection.region, geoSelection.province, r.name)
                }
              />
            ))
          )}
        </div>
      </div>
    );
  }

  return null;
}
