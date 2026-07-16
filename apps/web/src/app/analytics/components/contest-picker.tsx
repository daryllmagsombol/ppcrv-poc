'use client';

import { useMemo, useState } from 'react';
import { ContestItem } from '../types';

interface ContestPickerProps {
  contests: ContestItem[];
  selectedContest: string;
  onSelectContest: (code: string) => void;
}

const CATEGORY_ORDER = ['Senator', 'Party List', 'Governor', 'Vice Governor', 'Mayor', 'Vice Mayor', 'House of Reps', 'Provincial Board', 'Councilor', 'BARMM Parliament', 'BARMM Party Rep'];

export default function ContestPicker({ contests, selectedContest, onSelectContest }: ContestPickerProps) {
  const [category, setCategory] = useState('Senator');

  const filteredContests = useMemo(() => {
    return contests.filter(c => c.category === category);
  }, [contests, category]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const cat of CATEGORY_ORDER) {
      if (contests.some(c => c.category === cat)) {
        ordered.push(cat);
        seen.add(cat);
      }
    }
    // Add any remaining categories not in our order list
    for (const c of contests) {
      if (!seen.has(c.category)) {
        ordered.push(c.category);
        seen.add(c.category);
      }
    }
    return ordered;
  }, [contests]);

  const selectedName = useMemo(() => {
    const match = contests.find(c => c.code === selectedContest);
    return match?.name || selectedContest;
  }, [contests, selectedContest]);

  if (contests.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === cat
                ? 'bg-[#1B3A5C] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {cat}
            <span className="ml-1 opacity-60">
              {contests.filter(c => c.category === cat).length}
            </span>
          </button>
        ))}
      </div>

      {/* Contest dropdown */}
      <div className="flex items-center gap-2">
        <select
          value={selectedContest}
          onChange={e => onSelectContest(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#1B3A5C] focus:outline-none focus:ring-1 focus:ring-[#1B3A5C]"
        >
          {filteredContests.map(c => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Current selection */}
      <p className="text-xs text-gray-500">
        Showing: <span className="font-medium text-gray-700">{selectedName}</span>
      </p>
    </div>
  );
}
