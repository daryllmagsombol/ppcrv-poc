# "All" Category Tab for Results Page

**Date:** 2026-07-13

## Problem

The results page has Type tabs (Senator, Party List, Governor, etc.) that filter the contest dropdown. The user must pick a specific category and then a specific contest to see results. There's no way to see all contests at once.

## Goal

Add an "All" tab that shows all contests for the selected geography scope:
- **National level** (no geography): Show only Senator and Party List (national-only contests)
- **Geography level** (region/province/municipality/barangay/precinct): Show all contests for that geography, including Senator and Party List

When "All" is active, the contest dropdown is hidden since all contests are shown.

## Design

### Approach: Backend `national_only` filter + frontend "All" tab

Two files change:

### 1. Backend — `results.service.ts` + `result-query.dto.ts`

**DTO change:**
- Add `nationalOnly?: boolean` to `ResultQueryDto` (mapped from query param `national_only`)

**Query change (`buildQuery`):**
When `nationalOnly` is true, add a DuckDB WHERE clause:
```sql
(
  LPAD(CAST(contest_code AS VARCHAR), 8, '0') LIKE '003%'
  OR LPAD(CAST(contest_code AS VARCHAR), 8, '0') LIKE '011%'
)
```
This reuses the same prefix logic as `categoryFromCode()`:
- `'003'` prefix → Senator
- `'011'` prefix → Party List

The filter is only applied when `nationalOnly=true`. When geography is selected, the frontend omits this flag, so the backend returns all contests at that level (including Senator and Party List).

### 2. Frontend — `selection-panel.tsx`

**Category list:**
- Prepend `'All'` to `CATEGORY_ORDER` array
- "All" is selected by default on page load (replaces previous default of 'Senator')

**Contest dropdown:**
- Conditionally rendered: only show when `selectedCategory !== 'All'`
- When "All" is active, the dropdown is hidden entirely

**Results fetch logic (`onSelectionChange` effect):**
The current guard `if (!selectedContest) return;` is updated to also allow firing when `selectedCategory === 'All'`:

```
if (!selectedContest && selectedCategory !== 'All') return;
```

When "All" is active:
- Build geography filters the same way (level, reg, prv, mun, brgy, vc)
- Do NOT include `contest` in filters
- If no geography is selected (national level), add `national_only: 'true'`
- If geography IS selected, DO NOT add `national_only` — backend returns everything

**Auto-select behavior:**
The existing auto-select effect (picks the only contest when a category has exactly 1) skips when `selectedCategory === 'All'`.

### Files Changed

| File | Change |
|------|--------|
| `apps/api/src/modules/results/dto/result-query.dto.ts` | Add `nationalOnly?: boolean` |
| `apps/api/src/modules/results/results.service.ts` | Add `national_only` filter in `buildQuery()` |
| `apps/api/src/modules/results/__tests__/results.service.spec.ts` | Update tests for new filter |
| `apps/web/src/app/results/components/selection-panel.tsx` | "All" tab, hide contest dropdown, conditional fetch logic |

### Testing

- **Backend test**: `buildQuery` with `nationalOnly=true` → SQL contains LPAD LIKE conditions for '003%' and '011%'
- **Backend test**: `buildQuery` with `nationalOnly=false` (default) → no national_only filter in SQL
- **Frontend**: No automated UI tests (manual verification)
