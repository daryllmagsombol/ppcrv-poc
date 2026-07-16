'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { VoteShareResponse } from '../types';

interface VoteShareChartProps {
  data: VoteShareResponse | null;
  loading: boolean;
}

const COLORS = ['#1B3A5C', '#2E6F95', '#4A9EBC', '#7EC8E3', '#B3DFF2', '#D4A843', '#C17A3A', '#8B5A2B', '#5C4033', '#3E2723'];

export default function VoteShareChart({ data, loading }: VoteShareChartProps) {
  const [chartType, setChartType] = useState<'bar' | 'pie'>('bar');

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-gray-400">
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading...
      </div>
    );
  }

  if (!data || data.candidates.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        Select a geography to view vote share
      </div>
    );
  }

  const topCandidates = data.candidates.slice(0, 10);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Total votes: {data.totalVotes.toLocaleString()}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setChartType('bar')}
            className={`rounded px-2 py-0.5 text-xs ${chartType === 'bar' ? 'bg-[#1B3A5C] text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Bar
          </button>
          <button
            onClick={() => setChartType('pie')}
            className={`rounded px-2 py-0.5 text-xs ${chartType === 'pie' ? 'bg-[#1B3A5C] text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Pie
          </button>
        </div>
      </div>

      <div className="h-64">
        {chartType === 'bar' ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topCandidates} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis
                dataKey="name"
                type="category"
                width={120}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                formatter={(value: any, _name: any, props: any) => [
                  `${typeof value === 'number' ? value.toLocaleString() : value} (${props.payload.percentage}%)`,
                  'Votes',
                ]}
              />
              <Bar dataKey="votes" fill="#1B3A5C" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={topCandidates}
                dataKey="votes"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={true}
              >
                {topCandidates.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: any, _name: any, props: any) => [
                  `${typeof value === 'number' ? value.toLocaleString() : value} (${props.payload.percentage}%)`,
                  'Votes',
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
