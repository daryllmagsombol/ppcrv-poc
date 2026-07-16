'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RegionStatus, ProvinceStatus, CityStatus, GeoSelection } from '../types';

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

interface MapViewProps {
  loading: boolean;
  geoSelection: GeoSelection;
  regionStatuses: RegionStatus[];
  provinceStatuses: ProvinceStatus[];
  cityStatuses: CityStatus[];
  onSelectRegion: (name: string) => void;
  onSelectProvince: (region: string, province: string) => void;
  onSelectCity: (region: string, province: string, city: string) => void;
  onBack: () => void;
}

function getColor(rate: number): string {
  if (rate >= 80) return '#22c55e';
  if (rate >= 50) return '#eab308';
  if (rate >= 20) return '#f97316';
  return '#ef4444';
}

function getStyle(rate: number, isSelected: boolean) {
  return {
    fillColor: getColor(rate),
    weight: isSelected ? 3 : 1,
    opacity: 1,
    color: isSelected ? '#1B3A5C' : '#6b7280',
    fillOpacity: 0.7,
  };
}

function MapContent({
  loading, geoSelection, regionStatuses, provinceStatuses, cityStatuses,
  onSelectRegion, onSelectProvince, onSelectCity,
}: Omit<MapViewProps, 'onBack'>) {
  const map = useMap();
  const [geoJsonData, setGeoJsonData] = useState<any>(null);
  const [geoKey, setGeoKey] = useState(0);

  useEffect(() => {
    let file = 'regions.json';
    if (geoSelection.level === 'region') file = 'provinces.json';
    if (geoSelection.level === 'province') file = 'cities.json';

    fetch(`/analytics/data/${file}`)
      .then(res => res.json())
      .then(data => {
        setGeoJsonData(data);
        setGeoKey(k => k + 1);
      })
      .catch(() => setGeoJsonData(null));
  }, [geoSelection.level, geoSelection.region, geoSelection.province]);

  useEffect(() => {
    if (geoSelection.level === 'national') {
      map.setView([12.8797, 121.7740], 6);
    }
  }, [geoSelection.level, map]);

  // Show fallback list when GeoJSON is not available or has no features
  if (!geoJsonData || !geoJsonData.features?.length) {
    if (loading) {
      return (
        <div className="flex h-80 items-center justify-center text-sm text-gray-400">
          <Spinner />
        </div>
      );
    }
    if (geoSelection.level === 'national') {
      return (
        <div className="h-80 overflow-y-auto">
          <h3 className="mb-2 text-sm font-semibold text-gray-500">REGIONS</h3>
          {regionStatuses.map(r => (
            <button
              key={r.name}
              onClick={() => onSelectRegion(r.name)}
              className="flex w-full items-center justify-between border-b px-2 py-1.5 text-left text-sm hover:bg-gray-50"
            >
              <span>{r.name}</span>
              <span className="text-xs text-gray-400">{r.completionRate}%</span>
            </button>
          ))}
        </div>
      );
    } else if (geoSelection.level === 'region') {
      return (
        <div className="h-80 overflow-y-auto">
          <h3 className="mb-2 text-sm font-semibold text-gray-500">PROVINCES</h3>
          {provinceStatuses.map(r => (
            <button
              key={r.name}
              onClick={() => geoSelection.region && onSelectProvince(geoSelection.region, r.name)}
              className="flex w-full items-center justify-between border-b px-2 py-1.5 text-left text-sm hover:bg-gray-50"
            >
              <span>{r.name}</span>
              <span className="text-xs text-gray-400">{r.completionRate}%</span>
            </button>
          ))}
        </div>
      );
    } else if (geoSelection.level === 'province') {
      return (
        <div className="h-80 overflow-y-auto">
          <h3 className="mb-2 text-sm font-semibold text-gray-500">CITIES</h3>
          {cityStatuses.map(r => (
            <button
              key={r.name}
              onClick={() => geoSelection.region && geoSelection.province && onSelectCity(geoSelection.region, geoSelection.province, r.name)}
              className="flex w-full items-center justify-between border-b px-2 py-1.5 text-left text-sm hover:bg-gray-50"
            >
              <span>{r.name}</span>
              <span className="text-xs text-gray-400">{r.completionRate}%</span>
            </button>
          ))}
        </div>
      );
    }
  }

  const statusMap = new Map<string, number>();
  if (geoSelection.level === 'national') {
    regionStatuses.forEach(r => statusMap.set(r.name, r.completionRate));
  } else if (geoSelection.level === 'region') {
    provinceStatuses.forEach(r => statusMap.set(r.name, r.completionRate));
  } else if (geoSelection.level === 'province') {
    cityStatuses.forEach(r => statusMap.set(r.name, r.completionRate));
  }

  return (
    <GeoJSON
      key={geoKey}
      data={geoJsonData}
      style={(feature: any) => {
        const name = feature?.properties?.name || feature?.properties?.ADM1_EN || '';
        const rate = statusMap.get(name) ?? 0;
        const isSelected = false;
        return getStyle(rate, isSelected);
      }}
      onEachFeature={(feature: any, layer: L.Layer) => {
        const name = feature?.properties?.name ||
                     feature?.properties?.ADM1_EN ||
                     feature?.properties?.ADM2_EN ||
                     feature?.properties?.ADM3_EN ||
                     '';
        const rate = statusMap.get(name);

        layer.bindTooltip(`${name}: ${rate !== undefined ? `${rate}%` : 'No data'}`, {
          sticky: true,
        });

        layer.on({
          click: () => {
            if (geoSelection.level === 'national' && name) {
              onSelectRegion(name);
            } else if (geoSelection.level === 'region' && name && geoSelection.region) {
              onSelectProvince(geoSelection.region, name);
            } else if (geoSelection.level === 'province' && name && geoSelection.region && geoSelection.province) {
              onSelectCity(geoSelection.region, geoSelection.province, name);
            }
          },
        });
      }}
    />
  );
}

export default function MapView(props: MapViewProps) {
  return (
    <div className="h-80 overflow-hidden rounded-lg">
      <MapContainer
        center={[12.8797, 121.7740]}
        zoom={6}
        className="h-full w-full"
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapContent {...props} />
      </MapContainer>
    </div>
  );
}
