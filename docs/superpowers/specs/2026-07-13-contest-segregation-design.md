# Contest Segregation by Category & Geography — Design Spec

**Date**: 2026-07-13
**Status**: Draft
**Stack**: NestJS (API), Next.js (frontend), DuckDB (Parquet query), PostgreSQL (reference data)

---

## 1. Purpose & Scope

### What We're Building

Currently the contest dropdown shows all ~5,645 contests in a flat, unsorted list. We're adding:

1. **Contest categories** — group contests by type (Senator, Governor, Mayor, etc.) so users can filter by category
2. **Geography-aware contest filtering** — only show contests that exist in the selected region/province/municipality
3. **Better contest names** — replace raw contest_code with human-readable names from the reference data

### Out of Scope

- Modifying the ETL pipeline / Parquet schema
- Adding a Postgres connection to the NestJS API (contest names come from a static JSON lookup)
- Real-time contest updates

---

## 2. Contest Categories

Derived from the first 3 digits of `contest_code` (the contest type prefix):

| Code Prefix | Category Name | Display Order | Geographic Scope |
|---|---|---|---|
| 003 | Senator | 1 | National |
| 011 | Party List | 2 | National |
| 004 | Governor | 3 | Province-level |
| 005 | Vice Governor | 4 | Province-level |
| 007 | House of Reps | 5 | Legislative district |
| 006 | Provincial Board | 6 | Province/district |
| 008 | Mayor | 7 | Municipality-level |
| 009 | Vice Mayor | 8 | Municipality-level |
| 010 | Councilor | 9 | Municipality-level |
| 012 | BARMM Party Rep | 10 | BARMM only |
| 014 | BARMM Parliament | 11 | BARMM only |

Categories that are **not available** for the current geography are hidden from the tab bar.

---

## 3. API Changes

### Modified: `GET /api/contests`

**Current behavior:** Returns `[{ code, name }]` with no filtering — name is just the contest_code.

**New behavior:** Accepts optional geography query params and returns filtered contests with category info.

**Query Params:**
| Param | Type | Description |
|---|---|---|
| `reg` | string | Region name |
| `prv` | string | Province name |
| `mun` | string | Municipality name |
| `brgy` | string | Barangay name |

**Parquet level determination:**
- No params → `national` level, no WHERE clause
- `reg` only → `region` level, `WHERE reg_name = <reg>`
- `reg` + `prv` → `province` level, `WHERE reg_name = <reg> AND prv_name = <prv>`
- `reg` + `prv` + `mun` → `municipality` level, add `AND mun_name = <mun>`
- `reg` + `prv` + `mun` + `brgy` → `barangay` level, add `AND brgy_name = <brgy>`

**SQL generated:**
```sql
SELECT DISTINCT contest_code
FROM '{parquetBase}/{level}/**/*.parquet'
{whereClause}
ORDER BY contest_code
```

**Response schema:**
```json
[
  {
    "code": "00399000",
    "name": "SENATOR OF PHILIPPINES",
    "category": "Senator"
  },
  {
    "code": "00401000",
    "name": "PROVINCIAL GOVERNOR OF ABRA",
    "category": "Governor"
  }
]
```

Categories are derived from the first 3 digits of `contest_code` using a hardcoded map in the service layer.

Contest names are looked up from a static JSON file at `<project-root>/data/contest-names.json`.

### Endpoint: `GET /api/contest-categories` (new, optional)

If needed by the frontend to know the canonical category list and ordering, returns:

```json
[
  { "key": "Senator", "label": "Senator", "order": 1 },
  { "key": "Party List", "label": "Party List", "order": 2 },
  ...
]
```

The frontend can also derive this from the main contests response. This endpoint is a convenience.

---

## 4. Contest Names JSON

A static lookup file at `<project-root>/data/contest-names.json`:

```json
{
  "00399000": "SENATOR OF PHILIPPINES",
  "00401000": "PROVINCIAL GOVERNOR OF ABRA",
  ...
}
```

**Generation:** A one-time script `scripts/generate-contest-names.mjs` that reads `sample-csv/contest.csv` and writes the JSON file. Run once, committed to the repo.

**Loading:** The API service reads this file at startup (or lazily on first request) into a `Map<string, string>`.

---

## 5. Frontend Changes

### File: `SelectionPanel.tsx`

**Current layout:**
```
[Region] [Province] [Municipality] [Barangay] [VC]
[Contest]  ← flat dropdown of 5,645 items
```

**New layout:**
```
[Region] [Province] [Municipality] [Barangay] [VC]
━━━ Category tabs ━━━
[Senator] [Governor] [Mayor] [Vice Mayor] [Councilor] ...
━━━ Contest dropdown ━━━
(only contests matching selected geography + category)
```

**Data flow:**
```
onMount: GET /api/contests (no params)
  → returns national contests (Senator + Party List)
  → set categories = ["Senator", "Party List"]
  → set selectedCategory = "Senator"
  → filter contests for Senator → populate contest dropdown

onGeographyChange(reg, prv, mun, brgy):
  → GET /api/contests?reg=X&prv=Y&mun=Z&brgy=W
  → derive categories from response
  → if current category not in new list, reset to first available
  → filter contests for selected category

onCategoryChange(category):
  → filter the cached contest list to that category
  → reset contest selection
  → if only one contest in category, auto-select it

onContestChange(code):
  → same as before — calls onSelectionChange(filters)
```

**State additions:**
```typescript
const [contests, setContests] = useState<ContestInfo[]>([]); // replaces flat list
const [categories, setCategories] = useState<string[]>([]);
const [selectedCategory, setSelectedCategory] = useState<string>('');
```

**Category tab component:** A horizontal bar of pill/tab buttons. Only categories present in the current contest list are shown. Clicking one updates `selectedCategory`.

### File: no changes needed to `CascadingDropdown`, `ResultsTable`, `BreadcrumbNav`, or `page.tsx`

---

## 6. Default Load Behavior

On initial page load (no geography selected):

1. `GET /api/contests` with no params → returns national-level contests only
2. Expected result: Senator + Party List (2 categories)
3. Auto-select the first category tab (Senator)
4. Contest dropdown pre-populated with Senator contests
5. User sees results for the first Senator contest immediately (if contest auto-selected)

If only one contest exists in the selected category, auto-select it.

---

## 7. Edge Cases

| Scenario | Behavior |
|---|---|
| No geography selected | Show only national contests (Senator, Party List) |
| Geography has no contests | Show "No contests available for this location" |
| Category has no contests after geo change | Reset to first available category |
| Contest no longer exists after geo change | Reset contest selection |
| BARMM region selected | BARMM Party Rep + BARMM Parliament tabs appear |
| Single contest in category | Auto-select it |
| Contest JSON file missing | Log warning, fall back to contest_code as name |

---

## 8. Implementation Plan Summary

### Step 1: Generate contest names JSON
- Write `scripts/generate-contest-names.mjs`
- Run it → commit `data/contest-names.json`

### Step 2: Modify `ResultsService`
- Add `categoryFromCode(code)` method with the prefix→category map
- Add contest names JSON loading
- Modify `getContests()` to accept geography params and return enriched response
- Build Parquet level from params, query DuckDB CLI, merge names + categories

### Step 3: Modify `ResultsController`
- Update `GET /api/contests` to pass geography query params to service
- Add `GET /api/contest-categories` endpoint (optional)

### Step 4: Update frontend `SelectionPanel`
- Replace flat contest list with category tabs + filtered dropdown
- Implement geography-aware contest fetching
- Handle reset logic on geography/category changes

### Step 5: Verify
- Check that contest names render correctly
- Verify geography filtering narrows contests as expected
- Confirm empty and edge states work
