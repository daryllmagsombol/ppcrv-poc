'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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

interface ContestInfo {
  code: string;
  name: string;
  category: string;
}

const CATEGORY_ORDER = [
  'All','Senator','Party List','Governor','Vice Governor','House of Reps',
  'Provincial Board','Mayor','Vice Mayor','Councilor','BARMM Party Rep','BARMM Parliament',
];

export function SelectionPanel({ onSelectionChange }: SelectionPanelProps) {
  const [regions, setRegions] = useState<string[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);
  const [votingCenters, setVotingCenters] = useState<string[]>([]);
  const [contestInfos, setContestInfos] = useState<ContestInfo[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [loadingContests, setLoadingContests] = useState(false);

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

  // Generation counter to discard stale fetchContests responses
  const fetchGen = useRef(0);
  // Generation counter to discard stale geography fetch responses
  const geoGen = useRef(0);

  useEffect(() => {
    setLoading(prev => ({ ...prev, regions: true }));
    void fetchJson(`${API}/regions`)
      .then(setRegions)
      .catch(() => setRegions([]))
      .finally(() => setLoading(prev => ({ ...prev, regions: false })));
  }, []);

  const fetchContests = useCallback(async (geo: Record<string, string>) => {
    const gen = ++fetchGen.current;
    setLoadingContests(true);
    const params = new URLSearchParams(geo);
    const url = params.toString() ? `${API}/contests?${params}` : `${API}/contests`;
    try {
      const data: ContestInfo[] = await fetchJson(url);
      if (gen !== fetchGen.current) return; // stale response, discard
      const seen = new Set<string>();
      const cats: string[] = ['All'];
      for (const cat of CATEGORY_ORDER) {
        if (cat === 'All') continue;
        if (data.some(c => c.category === cat) && !seen.has(cat)) {
          seen.add(cat);
          cats.push(cat);
        }
      }
      setContestInfos(data);
      setCategories(cats);
      setSelectedCategory(prev => {
        if (prev === 'All' && cats.length > 0) return 'All';
        if (cats.includes(prev)) return prev;
        return cats.length > 0 ? cats[0] : '';
      });
    } catch {
      if (gen !== fetchGen.current) return;
      setContestInfos([]);
      setCategories([]);
      setSelectedCategory('');
    } finally {
      if (gen === fetchGen.current) setLoadingContests(false);
    }
  }, []);

  useEffect(() => {
    void fetchContests({});
  }, [fetchContests]);

  // Auto-select if only one contest in category
  useEffect(() => {
    if (selectedCategory === 'All') return;
    const filtered = contestInfos.filter(c => c.category === selectedCategory);
    if (filtered.length === 1 && selectedContest !== filtered[0].code) {
      setSelectedContest(filtered[0].code);
    }
  }, [selectedCategory, contestInfos, selectedContest]);

  useEffect(() => {
    if (!selectedRegion) { setProvinces([]); setSelectedProvince(''); return; }
    const gen = ++geoGen.current;
    setLoading(prev => ({ ...prev, provinces: true }));
    void fetchJson(`${API}/regions/${encodeURIComponent(selectedRegion)}/provinces`)
      .then(data => { if (gen === geoGen.current) setProvinces(data); })
      .catch(() => { if (gen === geoGen.current) setProvinces([]); })
      .finally(() => { if (gen === geoGen.current) setLoading(prev => ({ ...prev, provinces: false })); });
  }, [selectedRegion]);

  useEffect(() => {
    if (!selectedProvince) { setMunicipalities([]); setSelectedMunicipality(''); return; }
    const gen = ++geoGen.current;
    setLoading(prev => ({ ...prev, municipalities: true }));
    void fetchJson(`${API}/regions/${encodeURIComponent(selectedRegion)}/provinces/${encodeURIComponent(selectedProvince)}/municipalities`)
      .then(data => { if (gen === geoGen.current) setMunicipalities(data); })
      .catch(() => { if (gen === geoGen.current) setMunicipalities([]); })
      .finally(() => { if (gen === geoGen.current) setLoading(prev => ({ ...prev, municipalities: false })); });
  }, [selectedProvince, selectedRegion]);

  useEffect(() => {
    if (!selectedMunicipality) { setBarangays([]); setSelectedBarangay(''); return; }
    const gen = ++geoGen.current;
    setLoading(prev => ({ ...prev, barangays: true }));
    void fetchJson(`${API}/regions/${encodeURIComponent(selectedRegion)}/provinces/${encodeURIComponent(selectedProvince)}/municipalities/${encodeURIComponent(selectedMunicipality)}/barangays`)
      .then(data => { if (gen === geoGen.current) setBarangays(data); })
      .catch(() => { if (gen === geoGen.current) setBarangays([]); })
      .finally(() => { if (gen === geoGen.current) setLoading(prev => ({ ...prev, barangays: false })); });
  }, [selectedMunicipality, selectedProvince, selectedRegion]);

  useEffect(() => {
    if (!selectedBarangay) { setVotingCenters([]); setSelectedVC(''); return; }
    const gen = ++geoGen.current;
    setLoading(prev => ({ ...prev, vcs: true }));
    const vcParams = new URLSearchParams({
      reg: selectedRegion,
      prv: selectedProvince,
      mun: selectedMunicipality,
    });
    void fetchJson(`${API}/barangays/${encodeURIComponent(selectedBarangay)}/voting-centers?${vcParams}`)
      .then(data => { if (gen === geoGen.current) setVotingCenters(data); })
      .catch(() => { if (gen === geoGen.current) setVotingCenters([]); })
      .finally(() => { if (gen === geoGen.current) setLoading(prev => ({ ...prev, vcs: false })); });
  }, [selectedBarangay, selectedRegion, selectedProvince, selectedMunicipality]);

  useEffect(() => {
    if (!selectedContest && selectedCategory !== 'All') return;

    const filters: Record<string, string> = {};

    if (selectedContest) {
      filters.contest = selectedContest;
    } else if (selectedCategory === 'All') {
      // When "All" is active with no geography, only show national contests
      if (!selectedRegion && !selectedProvince && !selectedMunicipality && !selectedBarangay && !selectedVC) {
        filters.national_only = 'true';
      }
    }

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
  }, [selectedRegion, selectedProvince, selectedMunicipality, selectedBarangay, selectedVC, selectedContest, selectedCategory, onSelectionChange]);

  return (
    <div className="rounded border border-gray-200 bg-[#F8F6F0]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between bg-[#1B3A5C] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-[#F8F6F0]"
      >
        <span>SELECTION</span>
        {/* m6: Use Tailwind classes instead of inline style */}
        <span className={`transition-transform duration-200 ${collapsed ? '-rotate-90' : 'rotate-0'}`}>
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
              setSelectedContest('');
              void fetchContests({ reg: e.target.value });
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
              setSelectedContest('');
              void fetchContests({ reg: selectedRegion, prv: e.target.value });
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
              setSelectedContest('');
              void fetchContests({ reg: selectedRegion, prv: selectedProvince, mun: e.target.value });
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
              setSelectedContest('');
              void fetchContests({ reg: selectedRegion, prv: selectedProvince, mun: selectedMunicipality, brgy: e.target.value });
            }}
            disabled={!selectedMunicipality}
            loading={loading.barangays}
          />
          <CascadingDropdown
            label="VOTING CENTER"
            options={votingCenters.map(v => ({ value: v, label: v }))}
            value={selectedVC}
            // M2: Clear selectedContest on VC change (consistent with other handlers)
            onChange={(e) => {
              setSelectedVC(e.target.value);
              setSelectedContest('');
            }}
            disabled={!selectedBarangay}
            loading={loading.vcs}
          />
          {/* Category tabs */}
          {categories.length > 0 && (
            <div className="mt-3 mb-2 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2">
              <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[#1B3A5C]">
                Type:
              </span>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setSelectedContest('');
                  }}
                  className={`rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    selectedCategory === cat
                      ? 'bg-[#1B3A5C] text-[#F8F6F0]'
                      : 'bg-[#E8E5DE] text-[#1B3A5C] hover:bg-[#D0CCC0]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
          {selectedCategory !== 'All' && (
            <CascadingDropdown
              label="CONTEST"
              options={contestInfos
                .filter(c => c.category === selectedCategory || !selectedCategory)
                .map(c => ({ value: c.code, label: c.name }))}
              value={selectedContest}
              onChange={(e) => setSelectedContest(e.target.value)}
              disabled={contestInfos.length === 0 && !loadingContests}
              loading={loadingContests}
              placeholder={loadingContests ? 'Loading...' : 'Select Contest'}
            />
          )}
        </div>
      )}
    </div>
  );
}
