# Category-based QR Scan Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 3-slot QR scan flow with a flexible category-based system: unlimited QR scanning, no text duplicates, no category duplicates, and "Compare Results" always available.

**Architecture:** Frontend-only change. New `CategoryProgress` component replaces `ScanProgress`. `page.tsx` state changes from slot-based (`currentSlot`, `TOTAL_QRS`) to category-based (`captured Set`, `qrData Map`). Backend endpoint unchanged — `qr_raw_1/2/3` mapped from captured map.

**Tech Stack:** Next.js 15.5, React 19, TypeScript, Tailwind CSS

## Global Constraints

- Frontend only — no backend changes
- Keep existing `QRScanner` and `ComparisonView` components unchanged
- Use design tokens from Tailwind config (`ink`, `ballot`, `stamp`, `green-*`, `gray-*`)

---

### Task 1: Create CategoryProgress component

**Files:**
- Create: `apps/web/src/app/compare/components/category-progress.tsx`

**Interfaces:**
- Consumes: nothing (standalone component)
- Produces: `<CategoryProgress captured={Set<string>} totalCount={number} />`

- [ ] **Step 1: Write the component file**

```tsx
'use client';

interface CategoryProgressProps {
  /** Set of category strings already captured (e.g., 'NATIONAL', 'PARTY LIST', 'Metadata') */
  captured: Set<string>;
  /** Total number of QR codes captured (including Unknown ones) */
  totalCount: number;
}

const KNOWN_CATEGORIES = ['NATIONAL', 'PARTY LIST', 'Metadata'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  NATIONAL: 'National',
  'PARTY LIST': 'Party List',
  Metadata: 'Metadata',
};

export function CategoryProgress({ captured, totalCount }: CategoryProgressProps) {
  const allCaptured = KNOWN_CATEGORIES.every(c => captured.has(c));

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center justify-center gap-3">
        {KNOWN_CATEGORIES.map(cat => {
          const isDone = captured.has(cat);
          return (
            <div
              key={cat}
              className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-all
                ${isDone
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-300 bg-gray-50 text-gray-400'
                }`}
            >
              <span>{CATEGORY_LABELS[cat] || cat}</span>
              {isDone && <span className="text-green-600">✓</span>}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-gray-500">
        {allCaptured
          ? `✓ All QR codes captured (${totalCount})`
          : `${totalCount} QR code${totalCount === 1 ? '' : 's'} captured`
        }
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify component compiles**

Run: `cd apps/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `category-progress.tsx`

---

### Task 2: Rewrite page.tsx — category-based state and flow

**Files:**
- Modify: `apps/web/src/app/compare/page.tsx`

**Interfaces:**
- Consumes: `<CategoryProgress>` from Task 1
- Consumes: `<QRScanner>` (unchanged interface)
- Consumes: `<ComparisonView>` (unchanged interface)

- [ ] **Step 1: Update imports and remove constants**

Replace:
```tsx
import { ScanProgress } from './components/scan-progress';
```
With:
```tsx
import { CategoryProgress } from './components/category-progress';
```

Remove line: `const TOTAL_QRS = 3;`

- [ ] **Step 2: Replace state variables**

Replace:
```tsx
const [qrData, setQrData] = useState<string[]>([]);
const [currentSlot, setCurrentSlot] = useState(1);
```
With:
```tsx
const [qrData, setQrData] = useState<Map<string, string>>(new Map());
const [allScanned, setAllScanned] = useState(false);
```

- [ ] **Step 3: Add category detection function**

Add before the component function:

```tsx
/** Classify a raw QR text into a category. Returns null if unknown. */
function classifyQr(raw: string): string | null {
  if (raw.includes('00399000')) return 'NATIONAL';
  if (raw.includes('01199000')) return 'PARTY LIST';
  // Metadata QR: digits,comma,8+digits,comma,hex,comma,hex,comma,RV=
  if (/^\d+,\d{8,},[0-9A-Fa-f]+,[0-9A-Fa-f]+,RV=/i.test(raw.trim())) return 'Metadata';
  return null;
}
```

- [ ] **Step 4: Rewrite triggerComparison to use Map**

Replace:
```tsx
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
```
With:
```tsx
const triggerComparison = useCallback(async (captured: Map<string, string>) => {
    setStage('comparing');
    setError('');
    try {
      const values = Array.from(captured.values());
      const res = await fetch(`${API_URL}/scan/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          precinct_id: 'auto-detect',
          qr_raw_1: values[0] || '',
          qr_raw_2: values[1] || '',
          qr_raw_3: values[2] || '',
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
```

- [ ] **Step 5: Rewrite handleConfirmAndNext**

Replace:
```tsx
const handleConfirmAndNext = useCallback(() => {
    if (!pendingText) return;

    const updated = [...qrData];
    updated[currentSlot - 1] = pendingText;
    setQrData(updated);
    setPendingText(null);
    setCurrentSlot(s => s + 1);
  }, [pendingText, qrData, currentSlot]);
```
With:
```tsx
const handleConfirmAndNext = useCallback(() => {
    if (!pendingText) return;

    const cat = classifyQr(pendingText);
    if (!cat) {
      // Unknown — still store it as a generic entry
      const updated = new Map(qrData);
      updated.set(`Unknown-${Date.now()}`, pendingText);
      setQrData(updated);
    } else {
      // Known category — check for duplicate
      if (qrData.has(cat)) return; // duplicate category, ignore
      const updated = new Map(qrData);
      updated.set(cat, pendingText);
      setQrData(updated);

      // Auto-stop if all known categories captured
      if (['NATIONAL', 'PARTY LIST', 'Metadata'].every(c => updated.has(c) || qrData.has(c))) {
        setAllScanned(true);
      }
    }
    setPendingText(null);
  }, [pendingText, qrData]);
```

- [ ] **Step 6: Rewrite handleReject, remove handleBack**

Replace:
```tsx
const handleReject = useCallback(() => {
    setPendingText(null);
  }, []);
```

Keep `handleReject` as-is (unchanged).

Remove the `handleBack` callback entirely:
```tsx
/** User wants to go back to the previous slot */
const handleBack = useCallback(() => { ... });
```
→ Delete this function.

Remove `showBack` from the QRScanner props in the JSX later.

- [ ] **Step 7: Rewrite handleDoneScanning**

Replace:
```tsx
const handleDoneScanning = useCallback(() => {
    triggerComparison(qrData);
  }, [qrData, triggerComparison]);
```
With:
```tsx
const handleDoneScanning = useCallback(() => {
    triggerComparison(qrData);
  }, [qrData, triggerComparison]);
```
(Keep as-is — `qrData` is now a Map but `triggerComparison` handles it.)

- [ ] **Step 8: Update handleUpload to use Map**

Replace:
```tsx
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
          ...
        }),
      });
      ...
    }
  }, [comparison, qrData]);
```
With:
```tsx
const handleUpload = useCallback(async () => {
    if (!comparison) return;
    setIsUploading(true);
    try {
      const values = Array.from(qrData.values());
      const res = await fetch(`${API_URL}/scan/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          precinct_id: comparison.precinct_id,
          qr_raw_1: values[0] || '',
          qr_raw_2: values[1] || '',
          qr_raw_3: values[2] || '',
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
```

- [ ] **Step 9: Update handleReset**

Replace:
```tsx
const handleReset = useCallback(() => {
    setStage('idle');
    setQrData([]);
    setCurrentSlot(1);
    setComparison(null);
    setError('');
    setPendingText(null);
    setIsUploading(false);
  }, []);
```
With:
```tsx
const handleReset = useCallback(() => {
    setStage('idle');
    setQrData(new Map());
    setAllScanned(false);
    setComparison(null);
    setError('');
    setPendingText(null);
    setIsUploading(false);
  }, []);
```

- [ ] **Step 10: Update derived state**

Replace:
```tsx
const isAiming = stage === 'scanning' && !pendingText;
const allScanned = currentSlot > TOTAL_QRS && qrData.some(Boolean);
const progressScanned = Math.max(qrData.filter(Boolean).length, currentSlot - 1);
```
With:
```tsx
const isAiming = stage === 'scanning' && !pendingText;
const capturedCategories = new Set(
  Array.from(qrData.keys()).filter(k => ['NATIONAL', 'PARTY LIST', 'Metadata'].includes(k))
);
const hasAnyQr = qrData.size > 0;
const isComplete = allScanned || (
  ['NATIONAL', 'PARTY LIST', 'Metadata'].every(c => qrData.has(c))
);
```

- [ ] **Step 11: Rewrite the scanning section JSX**

Replace the scanning section (`stage === 'scanning' && !allScanned`) and the all-scanned section:

```tsx
      {stage === 'scanning' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <CategoryProgress
            captured={capturedCategories}
            totalCount={qrData.size}
          />

          <QRScanner
            onScan={handleScanResult}
            onError={handleScannerError}
            scanning={stage === 'scanning'}
            detectedText={pendingText ?? undefined}
            onConfirm={handleConfirmAndNext}
            onReject={handleReject}
            confirmLabel={isComplete ? 'Confirm — Done Scanning' : 'Confirm'}
            showBack={false}
          />

          {/* Skip button removed — "Re-scan" in the overlay handles ignoring a detection.
              "Compare Results" below is the way to say "I'm done scanning." */}

          {hasAnyQr && (
            <button
              onClick={handleDoneScanning}
              className="rounded-lg bg-ink px-8 py-3 font-semibold text-ballot transition hover:brightness-125"
            >
              Compare Results
            </button>
          )}

          {isComplete && hasAnyQr && (
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 underline hover:text-gray-700"
            >
              Start Over
            </button>
          )}
        </div>
      )}
```

(Remove the separate `stage === 'scanning' && allScanned` block — it's now merged into the single scanning section.)

---

### Task 3: Cleanup

**Files:**
- Modify: `apps/web/src/app/compare/page.tsx` (remove unused import)
- Optionally delete: `apps/web/src/app/compare/components/scan-progress.tsx`

- [ ] **Step 1: Remove unused ScanProgress import**

Verify that `ScanProgress` is no longer imported or used in `page.tsx`.

- [ ] **Step 2: (Optional) Delete scan-progress.tsx**

If no other file imports `ScanProgress`, delete it:
```bash
rm apps/web/src/app/compare/components/scan-progress.tsx
```

- [ ] **Step 3: Build check**

Run: `cd apps/web && npx tsc --noEmit --pretty 2>&1`
Expected: No TypeScript errors

- [ ] **Step 4: Manual smoke test**

Start dev server and verify:
1. Click "Start Scanning" → camera opens, no slot numbers
2. Scan a QR → badge fills in green, count updates
3. Scan same QR again → ignored (duplicate text)
4. Scan same category again → ignored (duplicate category)
5. "Compare Results" appears after first capture
6. Scan all 3 → auto-stops, "✓ All QR codes captured (3)"
7. Skip button works (keeps scanning, no advance)
8. Compare Results → comparison view shows correctly
