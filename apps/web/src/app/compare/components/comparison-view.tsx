'use client';

/** Derive a human-readable contest label from the contest code */
function contestLabel(code: string): string {
  const prefix = code.slice(0, 3);
  const map: Record<string, string> = {
    '003': 'Senator',
    '004': 'Governor',
    '005': 'Vice Governor',
    '006': 'Provincial Board',
    '007': 'House of Reps',
    '008': 'Mayor',
    '009': 'Vice Mayor',
    '010': 'Councilor',
    '011': 'Party List',
  };
  return map[prefix] || `Contest ${code}`;
}

interface CandidateVote {
  candidate: string;
  party: string;
  votes: number;
}

interface ContestResult {
  contest_code: string;
  contest_name: string;
  category: string;
  candidates: CandidateVote[];
}

interface Discrepancy {
  contest_code: string;
  contest_name: string;
  candidate: string;
  qr_votes: number;
  db_votes: number;
}

interface VcmMetadata {
  type: string;
  precinct_id: string;
  report_hash: string;
  result_hash: string;
  registered_voters: number;
  cast_ballots: number;
  remaining_ballots: number;
  voter_turnout_pct: number;
}

interface ComparisonViewProps {
  precinct_id: string;
  region?: string;
  province?: string;
  municipality?: string;
  barangay?: string;
  pollplace?: string;
  qr_parsed: ContestResult[];
  db_results: ContestResult[];
  has_discrepancy: boolean;
  discrepancy_details: Discrepancy[];
  qr_metadata?: VcmMetadata;
  onUpload: () => void;
  uploading?: boolean;
}

function isDiscrepant(
  contestCode: string,
  candidateName: string,
  discrepancies: Discrepancy[],
): boolean {
  return discrepancies.some(
    d => d.contest_code === contestCode && d.candidate === candidateName,
  );
}

function ContestTable({
  contest,
  discrepancies,
}: {
  contest: ContestResult;
  discrepancies: Discrepancy[];
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-display text-base font-bold text-ink">
          {contest.contest_name}
        </h3>
        <span className="rounded bg-field px-2 py-0.5 text-xs font-semibold uppercase text-ink">
          {contest.category}
        </span>
      </div>
      <table className="w-full border-t-2 border-b-2 border-ink">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-widest text-ink">
            <th className="px-3 py-2">Candidate</th>
            <th className="px-3 py-2">Party</th>
            <th className="px-3 py-2 text-right">Votes</th>
          </tr>
        </thead>
        <tbody>
          {contest.candidates.map((c, i) => {
            const discrepant = isDiscrepant(contest.contest_code, c.candidate, discrepancies);
            return (
              <tr
                key={`${contest.contest_code}-${c.candidate}-${i}`}
                className={`even:bg-field ${discrepant ? 'bg-red-100' : ''}`}
              >
                <td
                  className={`px-3 py-1.5 text-sm font-medium ${
                    discrepant ? 'font-bold text-red-800' : 'text-ink'
                  }`}
                >
                  {c.candidate}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-gray-600">{c.party}</td>
                <td
                  className={`px-3 py-1.5 text-right font-mono text-sm tabular-nums ${
                    discrepant ? 'font-bold text-red-700' : ''
                  }`}
                >
                  {c.votes.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ComparisonView({
  precinct_id,
  region,
  province,
  municipality,
  barangay,
  pollplace,
  qr_parsed,
  db_results,
  has_discrepancy,
  discrepancy_details,
  qr_metadata,
  onUpload,
  uploading,
}: ComparisonViewProps) {
  // Merge all contest codes from both sides for synced display
  const allContestCodes = new Set<string>();
  qr_parsed.forEach(c => allContestCodes.add(c.contest_code));
  db_results.forEach(c => allContestCodes.add(c.contest_code));

  const contestCodes = Array.from(allContestCodes).filter(c => c !== 'RAW');
  const hasRawQR = qr_parsed.some(c => c.contest_code === 'RAW');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-ballot p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-ink">
              Precinct: {precinct_id}
            </h2>
            {region && (
              <p className="mt-1 text-sm text-gray-600">
                {[barangay, municipality, province, region].filter(Boolean).join(' › ')}
                {pollplace && <span className="ml-2 text-gray-400">| {pollplace}</span>}
              </p>
            )}
          </div>
          {has_discrepancy ? (
            <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
              ⚠ Discrepancy Found
            </span>
          ) : (
            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
              ✓ Match Verified
            </span>
          )}
        </div>
      </div>

      {/* Raw unparsed QR data warning */}
      {hasRawQR && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            Some QR codes could not be parsed as structured data. Raw text is shown below.
          </p>
          <pre className="mt-2 max-h-48 overflow-y-auto overflow-x-auto rounded bg-yellow-100 p-2 text-xs text-yellow-900">
            {qr_parsed
              .filter(c => c.contest_code === 'RAW')
              .map(c => c.candidates.map(cd => cd.candidate).join('\n'))
              .join('\n---\n')}
          </pre>
        </div>
      )}

      {/* Metadata from QR3 */}
      {qr_metadata && (
        <div className="rounded-lg border border-gray-200 bg-field/50 p-4">
          <h3 className="mb-3 font-display text-base font-bold text-ink">Report Metadata</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Hashes */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Report Hash
              </p>
              <p className="break-all font-mono text-xs text-ink">
                {qr_metadata.report_hash}
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Result Hash
              </p>
              <p className="break-all font-mono text-xs text-ink">
                {qr_metadata.result_hash}
              </p>
            </div>
            {/* Voter turnout */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Voter Turnout
              </p>
              <p className="font-mono text-sm text-ink">
                {qr_metadata.registered_voters.toLocaleString()} registered
                <span className="mx-1.5 text-gray-400">|</span>
                {qr_metadata.cast_ballots.toLocaleString()} cast
                <span className="mx-1.5 text-gray-400">|</span>
                {qr_metadata.voter_turnout_pct}%
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                VCM Type
              </p>
              <p className="font-mono text-sm text-ink">{qr_metadata.type}</p>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-side tables */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Scanned QR Data */}
        <div>
          <h3 className="mb-4 font-display text-lg font-bold text-ink">
            Scanned QR Data
          </h3>
          {contestCodes.map(code => {
            const qrContest = qr_parsed.find(c => c.contest_code === code);
            if (!qrContest) {
              return (
                <div
                  key={`qr-${code}`}
                  className="mb-6 rounded border border-dashed border-gray-300 p-4 text-center text-sm text-gray-400"
                >
                  No QR data for {contestLabel(code)}
                </div>
              );
            }
            return (
              <ContestTable
                key={`qr-${code}`}
                contest={qrContest}
                discrepancies={discrepancy_details}
              />
            );
          })}
          {contestCodes.length === 0 && !hasRawQR && (
            <div className="rounded border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              No QR data scanned
            </div>
          )}
        </div>

        {/* Official DB Results */}
        <div>
          <h3 className="mb-4 font-display text-lg font-bold text-ink">
            Official Results
          </h3>
          {contestCodes.map(code => {
            const dbContest = db_results.find(c => c.contest_code === code);
            if (!dbContest) {
              return (
                <div
                  key={`db-${code}`}
                  className="mb-6 rounded border border-dashed border-gray-300 p-4 text-center text-sm text-gray-400"
                >
                  No data in DB for {contestLabel(code)}
                </div>
              );
            }
            return (
              <ContestTable
                key={`db-${code}`}
                contest={dbContest}
                discrepancies={discrepancy_details}
              />
            );
          })}
          {db_results.length === 0 && (
            <div className="rounded border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              Precinct not found in official results
            </div>
          )}
        </div>
      </div>

      {/* Discrepancy summary */}
      {discrepancy_details.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h4 className="mb-2 font-semibold text-red-800">
            Discrepancies ({discrepancy_details.length})
          </h4>
          <ul className="space-y-1 text-sm text-red-700">
            {discrepancy_details.map((d, i) => (
              <li key={i}>
                <strong>{d.contest_name}</strong> — {d.candidate}: QR has{' '}
                <strong>{d.qr_votes.toLocaleString()}</strong>, DB has{' '}
                <strong>{d.db_votes.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Upload button */}
      <div className="flex justify-center pt-4">
        <button
          onClick={onUpload}
          disabled={uploading}
          className="rounded-lg bg-ink px-8 py-3 font-semibold text-ballot transition hover:brightness-125 disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : 'Upload & Save'}
        </button>
      </div>
    </div>
  );
}
