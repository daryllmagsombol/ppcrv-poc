'use client';

import { useState, useCallback } from 'react';
import { SelectionPanel } from './components/selection-panel';
import { ResultsTable } from './components/results-table';
import { BreadcrumbNav } from './components/breadcrumb-nav';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

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

  const handleSelectionChange = useCallback(async (filters: Record<string, string>) => {
    setLoading(true);
    try {
      const params = new URLSearchParams(filters);
      const res = await fetch(`${API}/results?${params}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error('Failed to fetch results:', err);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 font-serif text-2xl font-bold text-[#1B3A5C]">
        Election Results
      </h1>

      <SelectionPanel onSelectionChange={handleSelectionChange} />

      {results && <BreadcrumbNav filters={results.filters} />}

      <ResultsTable
        contests={results?.contests || []}
        loading={loading}
      />
    </main>
  );
}
