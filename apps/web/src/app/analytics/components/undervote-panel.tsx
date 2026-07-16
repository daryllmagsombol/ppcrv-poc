'use client';

import { UndervoteResponse } from '../types';

interface UndervotePanelProps {
  data: UndervoteResponse | null;
  loading: boolean;
}

export default function UndervotePanel({ data, loading }: UndervotePanelProps) {
  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-400">
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

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className="text-2xl font-bold text-[#1B3A5C]">
            {data.totalVotes.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Total Votes Cast</div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className="text-2xl font-bold text-amber-600">
            {data.totalUndervotes.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Undervotes</div>
          <div className="text-xs font-medium text-amber-500">{data.undervoteRate}%</div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className={`text-2xl font-bold ${isOvervoteHigh ? 'text-red-600' : 'text-gray-600'}`}>
            {data.totalOvervotes.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Overvotes</div>
          <div className={`text-xs font-medium ${isOvervoteHigh ? 'text-red-500' : 'text-gray-400'}`}>
            {data.overvoteRate}%
            {isOvervoteHigh && <span className="ml-1">⚠️</span>}
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className="text-2xl font-bold text-green-600">
            {data.undervoteRate > 0 ? `${(data.totalVotes / (data.totalVotes - data.totalUndervotes)).toFixed(2)}x` : 'N/A'}
          </div>
          <div className="text-xs text-gray-500">Vote Efficiency</div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <div className="text-2xl font-bold text-purple-600">
            {data.totalVotes > 0
              ? `${((data.totalUndervotes + data.totalOvervotes) / data.totalVotes * 100).toFixed(1)}%`
              : 'N/A'}
          </div>
          <div className="text-xs text-gray-500">Combined Rate</div>
        </div>
      </div>

      {isOvervoteHigh && (
        <div className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">
          Overvote rate exceeds 0.5% threshold — may indicate election integrity concern
        </div>
      )}
    </div>
  );
}
