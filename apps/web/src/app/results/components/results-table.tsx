'use client';

interface Candidate {
  rank: number;
  name: string;
  party: string;
  votes: number;
  percentage: number;
}

interface ResultsTableProps {
  candidates: Candidate[];
  totalVotes: number;
  loading?: boolean;
}

export function ResultsTable({ candidates, totalVotes, loading }: ResultsTableProps) {
  if (loading) {
    return (
      <div className="mt-6 rounded border border-gray-200 bg-[#F8F6F0] p-8 text-center text-sm text-gray-500">
        Loading results...
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="mt-6 rounded border border-gray-200 bg-[#F8F6F0] p-8 text-center text-sm text-gray-500">
        No results found for this selection.
      </div>
    );
  }

  return (
    <div className="mt-6">
      <table className="w-full border-t-2 border-b-2 border-[#1B3A5C]">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-widest text-[#1B3A5C]">
            <th className="px-4 py-3">Rank</th>
            <th className="px-4 py-3">Candidate</th>
            <th className="px-4 py-3">Party</th>
            <th className="px-4 py-3 text-right">Votes</th>
            <th className="px-4 py-3 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.rank} className="even:bg-[#E8E5DE]">
              <td className="px-4 py-2 font-mono text-sm">{c.rank}</td>
              <td className="px-4 py-2 font-sans text-sm font-medium text-[#1B3A5C]">{c.name}</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600">{c.party}</td>
              <td className="px-4 py-2 text-right font-mono text-sm tabular-nums">{c.votes.toLocaleString()}</td>
              <td className="px-4 py-2 text-right font-mono text-sm tabular-nums">{c.percentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-right text-xs text-gray-500">
        Total votes: {totalVotes.toLocaleString()}
      </div>
    </div>
  );
}
