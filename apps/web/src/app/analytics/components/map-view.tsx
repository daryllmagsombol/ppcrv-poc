'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RegionStatus, ProvinceStatus, CityStatus, GeoSelection } from '../types';

interface MapViewProps {
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
  geoSelection, regionStatuses, provinceStatuses, cityStatuses,
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
  }, [geoSelection.level]);

  useEffect(() => {
    if (geoSelection.level === 'national') {
      map.setView([12.8797, 121.7740], 6);
    }
  }, [geoSelection.level, map]);

  if (!geoJsonData) {
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
