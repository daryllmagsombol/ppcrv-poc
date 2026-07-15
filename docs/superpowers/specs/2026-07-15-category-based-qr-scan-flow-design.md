# Category-based QR Scan Flow

## Problem

The current QR scan flow enforces exactly 3 fixed slots (1, 2, 3) with numbered progress circles. This is rigid — it requires the user to scan all 3 QRs or explicitly skip slots. The user wants a flexible flow: scan as many QRs as needed, with no limit, but prevent duplicate QR texts and duplicate category types.

## Requirements

1. **Unlimited scanning** — no fixed count of QR slots
2. **No duplicate text** — same QR content cannot be scanned twice
3. **No duplicate category** — only one QR per category (NATIONAL, PARTY LIST, Metadata)
4. **Skip available** — user can stop scanning whenever they feel it's enough
5. **"Compare Results" always accessible** — once at least 1 QR is captured, the button is visible
6. **Show everything** — comparison view shows QR data where available, and all DB contests

## Design

### 1. Category Detection (Frontend)

When a QR is scanned, classify it immediately on the frontend using simple pattern matching:

| Pattern | Category | Priority |
|---------|----------|----------|
| Contains `00399000` | NATIONAL | 1 |
| Contains `01199000` | PARTY LIST | 2 |
| Matches `digits,8+digits,hex,hex,RV=` pattern | Metadata | 3 |
| None of the above | Unknown | 4 |

Classification runs client-side so duplicate rejection is instant — no round trip to backend.

### 2. Progress UI — Category Badges

Replace numbered slot circles with a row of category badges:

```
[NATIONAL ✓]  [PARTY LIST]  [Metadata]
```

State rules:
- **Captured** (filled green) — category has been scanned
- **Not captured** (gray outline) — category not yet collected
- Unknown QRs don't get a badge but still increment the total count

Text below badges shows a summary:
- `"1 QR code captured"` — when some but not all categories collected
- `"✓ All QR codes captured"` — when all 3 categories collected
- `"Compare Results"` button always visible when at least 1 QR captured

### 3. State Management Changes

Replace slot-based state with category-based state in `page.tsx`:

```
captured: Set<string>         // categories collected so far
qrData: Map<string, string>   // category → raw QR text
autoStop: boolean             // when all known categories captured
```

Remove:
- `TOTAL_QRS = 3`
- `currentSlot`
- `allScanned` check
- `progressScanned` calculation

### 4. Scan Flow

1. User taps "Start Scanning" → camera opens
2. QR detected → frontend classifies:
   - If category already in `captured` → ignore (duplicate type)
   - If QR text already in `qrData.values()` → ignore (exact duplicate)
   - Else → add to `captured` + `qrData`, clear detection state, camera continues
3. After each capture, if `captured.size >= 3` (NATIONAL + PARTY LIST + Metadata) → auto-stop, show "Compare Results"
4. User can tap "Compare Results" anytime once `qrData.size >= 1`
5. Skip button always visible — no slot advance, just keeps camera running
6. On compare → map `qrData` entries to `qr_raw_1`, `qr_raw_2`, `qr_raw_3` for existing backend endpoint

### 5. Component Changes

| Component | Change |
|-----------|--------|
| `ScanProgress` | Replace with new `CategoryProgress` component (badge-based) |
| `page.tsx` | Rewrite scan state to use category tracking, remove slot logic |
| `QRScanner` | No changes needed (already handles continuous + dedup) |
| `ComparisonView` | No changes needed |

### 6. Edge Cases

| Scenario | Behavior |
|----------|----------|
| User scans 1 QR, taps Compare | Comparison shows that category's data; DB shows all contests |
| User scans 2 QRs (NATIONAL + PARTY LIST), skips Metadata | Same as above + metadata section absent |
| User scans same QR twice | Second scan ignored (text dedup) |
| User scans two NATIONAL QRs | Second scan ignored (category dedup) |
| User scans an unrecognized QR | Stored as RAW, shown in "Unparsed QR Data" warning section |
| User hits Back | Goes back to idle/reset state |

### 7. Open Questions

- None — all user decisions captured in design.

## Status

Approved by user on 2026-07-15.
