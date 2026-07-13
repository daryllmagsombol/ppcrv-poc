'use client';

interface Candidate {
  rank: number;
  name: string;
  party: string;
  votes: number;
  percentage: number;
}

interface ContestGroup {
  code: string;
  name: string;
  category: string;
  totalVotes: number;
  candidates: Candidate[];
  totals: { votesCast: number; overVotes: number; underVotes: number };
}

interface ResultsTableProps {
  contests: ContestGroup[];
  loading?: boolean;
}

function ContestTable({ contest }: { contest: ContestGroup }) {
  return (
    <div className="mb-8">
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="font-serif text-lg font-bold text-[#1B3A5C]">
          {contest.name}
        </h2>
        <span className="rounded bg-[#E8E5DE] px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[#1B3A5C]">
          {contest.category}
        </span>
      </div>
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
          {contest.candidates.map((c) => (
            // m8: Use unique key (code + rank + name) instead of rank-only
            <tr key={`${contest.code}-${c.rank}-${c.name}`} className="even:bg-[#E8E5DE]">
              <td className="px-4 py-2 font-mono text-sm">{c.rank}</td>
              <td className="px-4 py-2 font-sans text-sm font-medium text-[#1B3A5C]">{c.name}</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600">{c.party}</td>
              <td className="px-4 py-2 text-right font-mono text-sm tabular-nums">{c.votes.toLocaleString()}</td>
              <td className="px-4 py-2 text-right font-mono text-sm tabular-nums">{c.percentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 text-right text-xs text-gray-500">
        Total votes: {contest.totalVotes.toLocaleString()}
      </div>
    </div>
  );
}

export function ResultsTable({ contests, loading }: ResultsTableProps) {
  // m4: Loading overlay instead of replacing the table (no layout jump)
  if (loading && contests.length > 0) {
    return (
      <div className="relative mt-6">
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-white/60 pt-12">
          <div className="rounded bg-[#1B3A5C] px-4 py-2 text-sm font-semibold text-[#F8F6F0] shadow">
            Updating results...
          </div>
        </div>
        <div className="opacity-50">
          {contests.map((contest) => (
            <ContestTable key={contest.code} contest={contest} />
          ))}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-6 rounded border border-gray-200 bg-[#F8F6F0] p-8 text-center text-sm text-gray-500">
        Loading results...
      </div>
    );
  }

  if (contests.length === 0) {
    return (
      <div className="mt-6 rounded border border-gray-200 bg-[#F8F6F0] p-8 text-center text-sm text-gray-500">
        Select a contest to view results.
      </div>
    );
  }

  return (
    <div className="mt-6">
      {contests.map((contest) => (
        <ContestTable key={contest.code} contest={contest} />
      ))}
    </div>
  );
}
