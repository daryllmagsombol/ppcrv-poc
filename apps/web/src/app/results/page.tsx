'use client';

import { useState, useCallback, useRef } from 'react';
import { SelectionPanel } from './components/selection-panel';
import { ResultsTable } from './components/results-table';
import { BreadcrumbNav } from './components/breadcrumb-nav';

function getApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') return `http://${window.location.hostname}:3001/api`;
  return 'http://localhost:3001/api';
}
const API = getApiUrl();

interface ContestGroup {
  code: string;
  name: string;
  category: string;
  totalVotes: number;
  candidates: { rank: number; name: string; party: string; votes: number; percentage: number }[];
  totals: { votesCast: number; overVotes: number; underVotes: number };
}

interface ResultsData {
  level: string;
  filters: Record<string, string>;
  contests: ContestGroup[];
}

export default function ResultsPage() {
  const [results, setResults] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(false);
  // C2: AbortController to cancel in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  const handleSelectionChange = useCallback(async (filters: Record<string, string>) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const params = new URLSearchParams(filters);
      const res = await fetch(`${API}/results?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data: ResultsData = await res.json();
      if (!controller.signal.aborted) setResults(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to fetch results:', err);
      if (!controller.signal.aborted) setResults(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 font-serif text-2xl font-bold text-[#1B3A5C]">
        Election Results
      </h1>

      <SelectionPanel onSelectionChange={handleSelectionChange} />

      {results?.filters && <BreadcrumbNav filters={results.filters} />}

      {/* m3: Keep stale results visible while loading (no flash) */}
      <ResultsTable
        contests={results?.contests || []}
        loading={loading}
      />
    </main>
  );
}
