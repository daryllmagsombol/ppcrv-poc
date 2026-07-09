'use client';

import { useState, useEffect } from 'react';
import { CascadingDropdown } from './cascading-dropdown';

interface SelectionPanelProps {
  onSelectionChange: (filters: Record<string, string>) => void;
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function SelectionPanel({ onSelectionChange }: SelectionPanelProps) {
  const [regions, setRegions] = useState<string[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);
  const [votingCenters, setVotingCenters] = useState<string[]>([]);
  const [contests, setContests] = useState<{ code: string; name: string }[]>([]);

  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedMunicipality, setSelectedMunicipality] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState('');
  const [selectedVC, setSelectedVC] = useState('');
  const [selectedContest, setSelectedContest] = useState('');

  const [loading, setLoading] = useState({
    regions: false,
    provinces: false,
    municipalities: false,
    barangays: false,
    vcs: false,
  });

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setLoading(prev => ({ ...prev, regions: true }));
    fetchJson(`${API}/regions`)
      .then(setRegions)
      .catch(() => setRegions([]))
      .finally(() => setLoading(prev => ({ ...prev, regions: false })));
  }, []);

  useEffect(() => {
    fetchJson(`${API}/contests`)
      .then(setContests)
      .catch(() => setContests([]));
  }, []);

  useEffect(() => {
    if (!selectedRegion) { setProvinces([]); setSelectedProvince(''); return; }
    setLoading(prev => ({ ...prev, provinces: true }));
    fetchJson(`${API}/regions/${encodeURIComponent(selectedRegion)}/provinces`)
      .then(setProvinces)
      .catch(() => setProvinces([]))
      .finally(() => setLoading(prev => ({ ...prev, provinces: false })));
  }, [selectedRegion]);

  useEffect(() => {
    if (!selectedProvince) { setMunicipalities([]); setSelectedMunicipality(''); return; }
    setLoading(prev => ({ ...prev, municipalities: true }));
    fetchJson(`${API}/regions/${encodeURIComponent(selectedRegion)}/provinces/${encodeURIComponent(selectedProvince)}/municipalities`)
      .then(setMunicipalities)
      .catch(() => setMunicipalities([]))
      .finally(() => setLoading(prev => ({ ...prev, municipalities: false })));
  }, [selectedProvince]);

  useEffect(() => {
    if (!selectedMunicipality) { setBarangays([]); setSelectedBarangay(''); return; }
    setLoading(prev => ({ ...prev, barangays: true }));
    fetchJson(`${API}/regions/${encodeURIComponent(selectedRegion)}/provinces/${encodeURIComponent(selectedProvince)}/municipalities/${encodeURIComponent(selectedMunicipality)}/barangays`)
      .then(setBarangays)
      .catch(() => setBarangays([]))
      .finally(() => setLoading(prev => ({ ...prev, barangays: false })));
  }, [selectedMunicipality]);

  useEffect(() => {
    if (!selectedBarangay) { setVotingCenters([]); setSelectedVC(''); return; }
    setLoading(prev => ({ ...prev, vcs: true }));
    fetchJson(`${API}/barangays/${encodeURIComponent(selectedBarangay)}/voting-centers`)
      .then(setVotingCenters)
      .catch(() => setVotingCenters([]))
      .finally(() => setLoading(prev => ({ ...prev, vcs: false })));
  }, [selectedBarangay]);

  useEffect(() => {
    const filters: Record<string, string> = {};
    
    if (selectedContest) filters.contest = selectedContest;
    
    if (selectedVC) {
      filters.level = 'precinct';
      filters.vc = selectedVC;
    } else if (selectedBarangay) {
      filters.level = 'barangay';
      filters.brgy = selectedBarangay;
    } else if (selectedMunicipality) {
      filters.level = 'municipality';
      filters.mun = selectedMunicipality;
    } else if (selectedProvince) {
      filters.level = 'province';
      filters.prv = selectedProvince;
    } else if (selectedRegion) {
      filters.level = 'region';
      filters.reg = selectedRegion;
    } else {
      filters.level = 'national';
    }

    onSelectionChange(filters);
  }, [selectedRegion, selectedProvince, selectedMunicipality, selectedBarangay, selectedVC, selectedContest]);

  return (
    <div className="rounded border border-gray-200 bg-[#F8F6F0]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between bg-[#1B3A5C] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-[#F8F6F0]"
      >
        <span>SELECTION</span>
        <span className="transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}>
          ▼
        </span>
      </button>
      {!collapsed && (
        <div className="px-4 py-2">
          <CascadingDropdown
            label="REGION"
            options={regions.map(r => ({ value: r, label: r }))}
            value={selectedRegion}
            onChange={(e) => {
              setSelectedRegion(e.target.value);
              setSelectedProvince('');
              setSelectedMunicipality('');
              setSelectedBarangay('');
              setSelectedVC('');
            }}
            loading={loading.regions}
          />
          <CascadingDropdown
            label="PROVINCE"
            options={provinces.map(p => ({ value: p, label: p }))}
            value={selectedProvince}
            onChange={(e) => {
              setSelectedProvince(e.target.value);
              setSelectedMunicipality('');
              setSelectedBarangay('');
              setSelectedVC('');
            }}
            disabled={!selectedRegion}
            loading={loading.provinces}
          />
          <CascadingDropdown
            label="MUNICIPALITY"
            options={municipalities.map(m => ({ value: m, label: m }))}
            value={selectedMunicipality}
            onChange={(e) => {
              setSelectedMunicipality(e.target.value);
              setSelectedBarangay('');
              setSelectedVC('');
            }}
            disabled={!selectedProvince}
            loading={loading.municipalities}
          />
          <CascadingDropdown
            label="BARANGAY"
            options={barangays.map(b => ({ value: b, label: b }))}
            value={selectedBarangay}
            onChange={(e) => {
              setSelectedBarangay(e.target.value);
              setSelectedVC('');
            }}
            disabled={!selectedMunicipality}
            loading={loading.barangays}
          />
          <CascadingDropdown
            label="VOTING CENTER"
            options={votingCenters.map(v => ({ value: v, label: v }))}
            value={selectedVC}
            onChange={(e) => setSelectedVC(e.target.value)}
            disabled={!selectedBarangay}
            loading={loading.vcs}
          />
          <CascadingDropdown
            label="CONTEST"
            options={contests.map(c => ({ value: c.code, label: c.name || c.code }))}
            value={selectedContest}
            onChange={(e) => setSelectedContest(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
