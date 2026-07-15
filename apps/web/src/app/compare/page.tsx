'use client';

import { useState, useCallback } from 'react';
import { QRScanner } from './components/qr-scanner';
import { ScanProgress } from './components/scan-progress';
import { ComparisonView } from './components/comparison-view';

function getApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'https' : 'http';
    const port = window.location.port === '3000' ? '3001' : '3001';
    return `${proto}://${window.location.hostname}:${port}/api`;
  }
  return 'http://localhost:3001/api';
}
const API_URL = getApiUrl();
const TOTAL_QRS = 3;

type Stage = 'idle' | 'scanning' | 'comparing' | 'uploading' | 'done' | 'uploaded' | 'error';

interface ComparisonResult {
  precinct_id: string;
  region?: string;
  province?: string;
  municipality?: string;
  barangay?: string;
  pollplace?: string;
  qr_parsed: any[];
  db_results: any[];
  has_discrepancy: boolean;
  discrepancy_details: any[];
}

export default function ComparePage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [qrData, setQrData] = useState<string[]>([]);
  const [currentSlot, setCurrentSlot] = useState(1);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string>('');

  const triggerComparison = useCallback(async (scanned: string[]) => {
    setStage('comparing');
    setError('');
    try {
      const res = await fetch(`${API_URL}/scan/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          precinct_id: 'auto-detect',
          qr_raw_1: scanned[0] || '',
          qr_raw_2: scanned[1] || '',
          qr_raw_3: scanned[2] || '',
        }),
      });
      if (!res.ok) throw new Error('Compare request failed');
      const data = await res.json();
      setComparison(data);
      setStage('done');
    } catch (err: any) {
      setError(err.message || 'Failed to compare QR data');
      setStage('error');
    }
  }, []);

  const handleScanResult = useCallback(
    (decodedText: string) => {
      const updated = [...qrData];
      updated[currentSlot - 1] = decodedText;
      setQrData(updated);

      if (currentSlot >= TOTAL_QRS) {
        // All QR codes scanned — proceed to compare
        triggerComparison(updated);
      } else {
        setCurrentSlot(s => s + 1);
      }
    },
    [currentSlot, qrData, triggerComparison],
  );

  const handleDoneScanning = useCallback(() => {
    triggerComparison(qrData);
  }, [qrData, triggerComparison]);

  const handleUpload = useCallback(async () => {
    if (!comparison) return;
    setStage('uploading');
    try {
      const res = await fetch(`${API_URL}/scan/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          precinct_id: comparison.precinct_id,
          qr_raw_1: qrData[0] || '',
          qr_raw_2: qrData[1] || '',
          qr_raw_3: qrData[2] || '',
          qr_parsed: comparison.qr_parsed,
          db_results: comparison.db_results,
          has_discrepancy: comparison.has_discrepancy,
          discrepancy_details: comparison.discrepancy_details,
          scanned_by: 'Volunteer',
        }),
      });
      if (!res.ok) throw new Error('Upload failed');
      setStage('uploaded');
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      setStage('error');
    }
  }, [comparison, qrData]);

  const handleReset = useCallback(() => {
    setStage('idle');
    setQrData([]);
    setCurrentSlot(1);
    setComparison(null);
    setError('');
  }, []);

  const handleScannerError = useCallback((err: string) => {
    setError(err);
    setStage('error');
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-8 font-serif text-3xl font-bold text-[#1B3A5C]">
        Scan to Compare
      </h1>

      {stage === 'idle' && (
        <div className="flex flex-col items-center gap-6 py-12">
          <p className="max-w-md text-center text-gray-600">
            Scan QR codes from the VCM receipt to verify the printed results against the
            official election data in the database.
          </p>
          <button
            onClick={() => setStage('scanning')}
            className="rounded-lg bg-[#1B3A5C] px-8 py-3 font-semibold text-[#F8F6F0] transition hover:bg-[#2a4d73]"
          >
            Start Scanning
          </button>
        </div>
      )}

      {stage === 'scanning' && (
        <div className="flex flex-col items-center gap-6 py-8">
          <ScanProgress
            scanned={qrData.length}
            total={TOTAL_QRS}
            currentScanning={currentSlot}
          />
          <QRScanner
            onScan={handleScanResult}
            onError={handleScannerError}
            scanning={stage === 'scanning'}
          />
          <button
            onClick={handleDoneScanning}
            className="text-sm text-gray-500 underline hover:text-gray-700"
          >
            Done scanning (skip remaining)
          </button>
        </div>
      )}

      {stage === 'comparing' && (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#E8E5DE] border-t-[#1B3A5C]" />
          <p className="text-gray-600">Comparing QR data against official results...</p>
        </div>
      )}

      {stage === 'error' && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8">
          <p className="text-red-700">{error}</p>
          <div className="flex gap-4">
            <button
              onClick={handleReset}
              className="rounded-lg bg-[#1B3A5C] px-6 py-2 font-semibold text-[#F8F6F0]"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {(stage === 'done' || stage === 'uploaded') && comparison && (
        <>
          {stage === 'done' && (
            <ComparisonView
              precinct_id={comparison.precinct_id}
              region={comparison.region}
              province={comparison.province}
              municipality={comparison.municipality}
              barangay={comparison.barangay}
              pollplace={comparison.pollplace}
              qr_parsed={comparison.qr_parsed}
              db_results={comparison.db_results}
              has_discrepancy={comparison.has_discrepancy}
              discrepancy_details={comparison.discrepancy_details}
              onUpload={handleUpload}
              uploading={false}
            />
          )}
          {stage === 'uploaded' && (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-green-200 bg-green-50 p-8">
              <p className="text-lg font-semibold text-green-700">
                ✓ Scan record uploaded successfully
              </p>
              <p className="text-sm text-green-600">
                Precinct {comparison.precinct_id} —{' '}
                {comparison.has_discrepancy
                  ? `${comparison.discrepancy_details.length} discrepancy(ies) found`
                  : 'No discrepancies found'}
              </p>
            </div>
          )}
          <div className="mt-8 text-center">
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 underline hover:text-gray-700"
            >
              Scan another receipt
            </button>
          </div>
        </>
      )}

      {stage === 'uploading' && (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#E8E5DE] border-t-[#1B3A5C]" />
          <p className="text-gray-600">Uploading scan record...</p>
        </div>
      )}
    </div>
  );
}
