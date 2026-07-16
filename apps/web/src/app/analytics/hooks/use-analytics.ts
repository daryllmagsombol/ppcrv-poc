'use client';

import { useState, useCallback, useEffect } from 'react';
import { RegionStatus, ProvinceStatus, CityStatus, VoteShareResponse, UndervoteResponse, GeoSelection, ContestItem } from '../types';

const API = '/api/analytics';
const CONTESTS_API = '/api/contests';

export function useAnalytics() {
  const [geoLoading, setGeoLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoSelection, setGeoSelection] = useState<GeoSelection>({ level: 'national' });
  const [regionStatuses, setRegionStatuses] = useState<RegionStatus[]>([]);
  const [provinceStatuses, setProvinceStatuses] = useState<ProvinceStatus[]>([]);
  const [cityStatuses, setCityStatuses] = useState<CityStatus[]>([]);
  const [voteShare, setVoteShare] = useState<VoteShareResponse | null>(null);
  const [undervotes, setUndervotes] = useState<UndervoteResponse | null>(null);
  const [contests, setContests] = useState<ContestItem[]>([]);
  const [selectedContest, setSelectedContest] = useState('00399000');

  // Fetch contest list once on mount
  useEffect(() => {
    fetch(CONTESTS_API)
      .then(r => r.json())
      .then((list: ContestItem[]) => setContests(list))
      .catch(() => {});
  }, []);

  const fetchGeo = useCallback(async (url: string) => {
    setGeoLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return await res.json();
    } catch (err) {
      throw err;
    } finally {
      setGeoLoading(false);
    }
  }, []);

  const fetchChart = useCallback(async (url: string) => {
    setChartLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return await res.json();
    } catch (err) {
      throw err;
    } finally {
      setChartLoading(false);
    }
  }, []);

  // Re-fetch vote share + undervotes when contest changes
  const reloadContestData = useCallback(async (contest: string, geo: GeoSelection) => {
    const params = new URLSearchParams();
    params.set('contest', contest);
    if (geo.region) params.set('reg', geo.region);
    if (geo.province) params.set('prv', geo.province);
    if (geo.city) params.set('mun', geo.city);

    const [vsData, uvData] = await Promise.all([
      fetchChart(`${API}/vote-share?${params}`),
      fetchChart(`${API}/undervotes?${params}`),
    ]);

    if (vsData) {
      const code = vsData.contest || contest;
      const match = contests.find((c: ContestItem) => c.code === code);
      vsData.contestName = match?.name || code;
      setVoteShare(vsData);
    }
    if (uvData) setUndervotes(uvData);
  }, [fetchChart, contests]);

  const loadGeographyStatus = useCallback(async () => {
    try {
      const data = await fetchGeo(`${API}/geography-status`);
      if (data) setRegionStatuses(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchGeo]);

  const loadProvinceStatus = useCallback(async (region: string) => {
    try {
      const data = await fetchGeo(`${API}/geography-status/regions/${encodeURIComponent(region)}`);
      if (data) setProvinceStatuses(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchGeo]);

  const loadCityStatus = useCallback(async (region: string, province: string) => {
    try {
      const data = await fetchGeo(
        `${API}/geography-status/regions/${encodeURIComponent(region)}/provinces/${encodeURIComponent(province)}`
      );
      if (data) setCityStatuses(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchGeo]);

  const setContest = useCallback((code: string) => {
    setSelectedContest(code);
    reloadContestData(code, geoSelection);
  }, [geoSelection, reloadContestData]);

  const selectRegion = useCallback(async (region: string) => {
    const sel: GeoSelection = { level: 'region', region };
    setGeoSelection(sel);
    setProvinceStatuses([]);
    setCityStatuses([]);
    await Promise.all([
      loadProvinceStatus(region),
      reloadContestData(selectedContest, sel),
    ]);
  }, [loadProvinceStatus, reloadContestData, selectedContest]);

  const selectProvince = useCallback(async (region: string, province: string) => {
    const sel: GeoSelection = { level: 'province', region, province };
    setGeoSelection(sel);
    setCityStatuses([]);
    await Promise.all([
      loadCityStatus(region, province),
      reloadContestData(selectedContest, sel),
    ]);
  }, [loadCityStatus, reloadContestData, selectedContest]);

  const selectCity = useCallback(async (region: string, province: string, city: string) => {
    const sel: GeoSelection = { level: 'city', region, province, city };
    setGeoSelection(sel);
    await reloadContestData(selectedContest, sel);
  }, [reloadContestData, selectedContest]);

  const goToNational = useCallback(async () => {
    setGeoSelection({ level: 'national' });
    setProvinceStatuses([]);
    setCityStatuses([]);
    await Promise.all([
      loadGeographyStatus(),
      reloadContestData(selectedContest, { level: 'national' }),
    ]);
  }, [loadGeographyStatus, reloadContestData, selectedContest]);

  return {
    geoLoading, chartLoading, error, geoSelection,
    regionStatuses, provinceStatuses, cityStatuses,
    voteShare, undervotes,
    contests, selectedContest, setContest,
    loadGeographyStatus, selectRegion, selectProvince, selectCity, goToNational,
  };
}
