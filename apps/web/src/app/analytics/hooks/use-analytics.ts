'use client';

import { useState, useCallback, useRef } from 'react';
import { RegionStatus, ProvinceStatus, CityStatus, VoteShareResponse, UndervoteResponse, GeoSelection } from '../types';

const API = '/api/analytics';

export function useAnalytics() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoSelection, setGeoSelection] = useState<GeoSelection>({ level: 'national' });
  const [regionStatuses, setRegionStatuses] = useState<RegionStatus[]>([]);
  const [provinceStatuses, setProvinceStatuses] = useState<ProvinceStatus[]>([]);
  const [cityStatuses, setCityStatuses] = useState<CityStatus[]>([]);
  const [voteShare, setVoteShare] = useState<VoteShareResponse | null>(null);
  const [undervotes, setUndervotes] = useState<UndervoteResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchJson = useCallback(async (url: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const loadGeographyStatus = useCallback(async () => {
    try {
      const data = await fetchJson(`${API}/geography-status`);
      if (data) setRegionStatuses(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const loadProvinceStatus = useCallback(async (region: string) => {
    try {
      const data = await fetchJson(`${API}/geography-status/regions/${encodeURIComponent(region)}`);
      if (data) setProvinceStatuses(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const loadCityStatus = useCallback(async (region: string, province: string) => {
    try {
      const data = await fetchJson(
        `${API}/geography-status/regions/${encodeURIComponent(region)}/provinces/${encodeURIComponent(province)}`
      );
      if (data) setCityStatuses(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const loadVoteShare = useCallback(async (selection: GeoSelection, contest?: string) => {
    const params = new URLSearchParams();
    if (contest) params.set('contest', contest);
    if (selection.region) params.set('reg', selection.region);
    if (selection.province) params.set('prv', selection.province);
    if (selection.city) params.set('mun', selection.city);
    try {
      const data = await fetchJson(`${API}/vote-share?${params}`);
      if (data) setVoteShare(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const loadUndervotes = useCallback(async (selection: GeoSelection, contest?: string) => {
    const params = new URLSearchParams();
    if (contest) params.set('contest', contest);
    if (selection.region) params.set('reg', selection.region);
    if (selection.province) params.set('prv', selection.province);
    if (selection.city) params.set('mun', selection.city);
    try {
      const data = await fetchJson(`${API}/undervotes?${params}`);
      if (data) setUndervotes(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchJson]);

  const selectRegion = useCallback(async (region: string) => {
    const sel: GeoSelection = { level: 'region', region };
    setGeoSelection(sel);
    setProvinceStatuses([]);
    setCityStatuses([]);
    await Promise.all([
      loadProvinceStatus(region),
      loadVoteShare(sel),
      loadUndervotes(sel),
    ]);
  }, [loadProvinceStatus, loadVoteShare, loadUndervotes]);

  const selectProvince = useCallback(async (region: string, province: string) => {
    const sel: GeoSelection = { level: 'province', region, province };
    setGeoSelection(sel);
    setCityStatuses([]);
    await Promise.all([
      loadCityStatus(region, province),
      loadVoteShare(sel),
      loadUndervotes(sel),
    ]);
  }, [loadCityStatus, loadVoteShare, loadUndervotes]);

  const selectCity = useCallback(async (region: string, province: string, city: string) => {
    const sel: GeoSelection = { level: 'city', region, province, city };
    setGeoSelection(sel);
    await Promise.all([
      loadVoteShare(sel),
      loadUndervotes(sel),
    ]);
  }, [loadVoteShare, loadUndervotes]);

  const goToNational = useCallback(async () => {
    setGeoSelection({ level: 'national' });
    setProvinceStatuses([]);
    setCityStatuses([]);
    await Promise.all([
      loadGeographyStatus(),
      loadVoteShare({ level: 'national' }),
      loadUndervotes({ level: 'national' }),
    ]);
  }, [loadGeographyStatus, loadVoteShare, loadUndervotes]);

  return {
    loading, error, geoSelection,
    regionStatuses, provinceStatuses, cityStatuses,
    voteShare, undervotes,
    loadGeographyStatus, selectRegion, selectProvince, selectCity, goToNational,
  };
}
