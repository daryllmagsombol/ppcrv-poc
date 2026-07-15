'use client';

import { useState, useCallback } from 'react';
import { QRScanner } from './components/qr-scanner';
import { ScanProgress } from './components/scan-progress';
import { ComparisonView } from './components/comparison-view';

function getApiUrl(): string {
  return '/api';
}
const API_URL = getApiUrl();
const TOTAL_QRS = 3;

type Stage = 'idle' | 'scanning' | 'comparing' | 'done' | 'uploaded' | 'error';

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
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

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
      setPendingText(decodedText);
    },
    [],
  );

  /** User confirms the detected QR text — save it and advance */
  const handleConfirmAndNext = useCallback(() => {
    if (!pendingText) return;

    const updated = [...qrData];
    updated[currentSlot - 1] = pendingText;
    setQrData(updated);
    setPendingText(null);
    setCurrentSlot(s => s + 1);
  }, [pendingText, qrData, currentSlot]);

  /** User wants to re-scan the current slot */
  const handleReject = useCallback(() => {
    setPendingText(null);
  }, []);

  /** User wants to go back to the previous slot */
  const handleBack = useCallback(() => {
    if (currentSlot <= 1) return;
    const updated = [...qrData];
    updated[currentSlot - 2] = ''; // clear the previous slot
    setQrData(updated);
    setCurrentSlot(s => s - 1);
    setPendingText(null);
  }, [currentSlot, qrData]);

  /** Called via the "Compare Results" button */
  const handleDoneScanning = useCallback(() => {
    triggerComparison(qrData);
  }, [qrData, triggerComparison]);

  const handleUpload = useCallback(async () => {
    if (!comparison) return;
    setIsUploading(true);
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
      setIsUploading(false);
      setStage('uploaded');
    } catch (err: any) {
      setIsUploading(false);
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
    setPendingText(null);
    setIsUploading(false);
  }, []);

  const handleScannerError = useCallback((err: string) => {
    setError(err);
    setStage('error');
  }, []);

  const isAiming = stage === 'scanning' && !pendingText;
  const allScanned = currentSlot > TOTAL_QRS && qrData.some(Boolean);
  // Show slots up to (currentSlot - 1) as visited (scanned or skipped)
  const progressScanned = Math.max(qrData.filter(Boolean).length, currentSlot - 1);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-8 font-display text-3xl font-bold text-ink">
        Scan to Compare
      </h1>

      {stage === 'idle' && (
        <div className="flex flex-col items-center gap-6 py-12">
          <p className="max-w-md text-center text-gray-600">
            Scan QR codes from the VCM receipt to verify the printed results
            against the official election data in the database.
          </p>
          <button
            onClick={() => setStage('scanning')}
            className="rounded-lg bg-ink px-8 py-3 font-semibold text-ballot transition hover:brightness-125"
          >
            Start Scanning
          </button>
        </div>
      )}

      {stage === 'scanning' && !allScanned && (
        <div className="flex flex-col items-center gap-4 py-4">
          <ScanProgress
            scanned={progressScanned}
            total={TOTAL_QRS}
            currentScanning={currentSlot}
          />

          <QRScanner
            onScan={handleScanResult}
            onError={handleScannerError}
            scanning={stage === 'scanning'}
            detectedText={pendingText ?? undefined}
            onConfirm={handleConfirmAndNext}
            onReject={handleReject}
            onBack={handleBack}
            confirmLabel={
              currentSlot >= TOTAL_QRS
                ? 'Confirm — Done Scanning'
                : `Confirm & Next (Slot ${currentSlot + 1})`
            }
            showBack={currentSlot > 1}
          />

          {isAiming && (
            <button
              onClick={() => {
                setCurrentSlot(s => s + 1);
              }}
              className="flex items-center justify-center rounded-lg border border-gray-400 px-6 py-3 text-sm text-gray-600 transition hover:bg-gray-100 min-w-[44px] min-h-[44px]"
              type="button"
            >
              Skip this QR
            </button>
          )}
        </div>
      )}

      {/* All QR slots filled — show the "Compare" button */}
      {stage === 'scanning' && allScanned && (
        <div className="flex flex-col items-center gap-4 py-8">
          <ScanProgress
            scanned={progressScanned}
            total={TOTAL_QRS}
            currentScanning={currentSlot}
          />
          <p className="text-lg font-semibold text-green-700">
            ✓ {qrData.filter(Boolean).length}/{TOTAL_QRS} QR codes captured
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleDoneScanning}
              className="rounded-lg bg-ink px-8 py-3 font-semibold text-ballot transition hover:brightness-125"
            >
              Compare Results
            </button>
            <button
              onClick={handleReset}
              className="rounded-lg border border-gray-400 px-6 py-3 text-sm text-gray-600 transition hover:bg-gray-100"
            >
              Start Over
            </button>
          </div>
        </div>
      )}

      {stage === 'comparing' && (
        <div role="status" className="flex flex-col items-center gap-4 py-12">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-field border-t-ink" />
          <p className="text-gray-600">
            Comparing QR data against official results...
          </p>
        </div>
      )}

      {stage === 'error' && (
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8"
        >
          <p className="text-center text-red-700">{error}</p>
          {error.toLowerCase().includes('permission') && (
            <div className="max-w-sm text-left text-sm text-red-600">
              <p className="mb-2 font-medium">To fix this:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  <strong>iPhone/iPad:</strong> Go to{' '}
                  <em>Settings → Safari → Camera</em> and make sure it&apos;s
                  set to &quot;Allow&quot;
                </li>
                <li>
                  <strong>Android Chrome:</strong> Tap the lock icon in the URL
                  bar → Site Settings → Camera → Allow
                </li>
                <li>
                  <strong>Desktop:</strong> Click the camera icon in the URL bar
                  and grant permission
                </li>
                <li>After changing permissions, refresh the page</li>
              </ol>
            </div>
          )}
          {error.toLowerCase().includes('https') && (
            <div className="max-w-sm text-left text-sm text-red-600">
              <p className="mb-2 font-medium">To fix this:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Make sure the URL starts with <strong>https://</strong>
                </li>
                <li>
                  If you&apos;re testing locally, use{' '}
                  <strong>https://localhost</strong> or{' '}
                  <strong>http://localhost</strong> (local host is treated as
                  secure)
                </li>
              </ol>
            </div>
          )}
          <div className="flex gap-4">
            <button
              onClick={handleReset}
              className="rounded-lg bg-ink px-6 py-2 font-semibold text-ballot"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Done stage — shows ComparisonView (with inline upload loading) */}
      {stage === 'done' && comparison && (
        <>
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
            uploading={isUploading}
          />
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

      {/* Uploaded confirmation */}
      {stage === 'uploaded' && comparison && (
        <>
          <div
            role="status"
            className="flex flex-col items-center gap-4 rounded-lg border border-green-200 bg-green-50 p-8"
          >
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
    </div>
  );
}
