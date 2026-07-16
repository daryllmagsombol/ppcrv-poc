'use client';

import { UndervoteResponse } from '../types';

interface UndervotePanelProps {
  data: UndervoteResponse | null;
  loading: boolean;
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function UndervotePanel({ data, loading }: UndervotePanelProps) {
  if (loading) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-gray-400">
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-400">
        Select a geography to view undervote analysis
      </div>
    );
  }

  const isOvervoteHigh = data.overvoteRate > 0.5;
  const efficiency = data.undervoteRate > 0
    ? `${(data.totalVotes / (data.totalVotes - data.totalUndervotes)).toFixed(1)}x`
    : 'N/A';
  const combinedRate = data.totalVotes > 0
    ? ((data.totalUndervotes + data.totalOvervotes) / data.totalVotes * 100).toFixed(1)
    : 'N/A';

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Votes Cast" value={formatNum(data.totalVotes)} color="text-[#1B3A5C]" />
        <StatCard
          label="Undervotes"
          value={formatNum(data.totalUndervotes)}
          color="text-amber-600"
          sub={`${data.undervoteRate}%`}
          subColor="text-amber-500"
        />
        <StatCard
          label="Overvotes"
          value={formatNum(data.totalOvervotes)}
          color={isOvervoteHigh ? 'text-red-600' : 'text-gray-600'}
          sub={`${data.overvoteRate}%${isOvervoteHigh ? ' ⚠' : ''}`}
          subColor={isOvervoteHigh ? 'text-red-500' : 'text-gray-400'}
        />
        <StatCard label="Vote Efficiency" value={efficiency} color="text-green-600" />
        <StatCard label="Combined Rate" value={`${combinedRate}%`} color="text-purple-600" />
      </div>

      {isOvervoteHigh && (
        <div className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">
          Overvote rate exceeds 0.5% threshold — may indicate election integrity concern
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  sub,
  subColor,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-3 text-center">
      <div className={`text-lg font-bold leading-tight ${color}`}>{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-gray-500">{label}</div>
      {sub && (
        <div className={`mt-0.5 text-[11px] font-medium ${subColor || 'text-gray-400'}`}>{sub}</div>
      )}
    </div>
  );
}
