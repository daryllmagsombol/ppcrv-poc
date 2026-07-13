# "All" Category Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "All" Type tab that shows all contests (Senator + Party List at national level, everything at geography level)

**Architecture:** Backend gets a `national_only` query param that filters results to Senator (003*) and Party List (011*) contest codes. Frontend prepends "All" to category tabs, hides contest dropdown when "All" is active, and sends `national_only=true` when no geography is selected.

**Tech Stack:** NestJS, DuckDB CLI, Next.js, TypeScript

## Global Constraints

- All tests must pass after each task: `npm test` in `apps/api/` (17 tests)
- TypeScript must compile clean: `npx tsc --noEmit` in `apps/web/`
- Follow existing patterns in `results.service.ts` (esc() for SQL escaping, cleanContestCode() for integer parsing)

---

### Task 1: Backend DTO — add nationalOnly field

**Files:**
- Modify: `apps/api/src/modules/results/dto/result-query.dto.ts:28-31`

**Interfaces:**
- Consumes: nothing
- Produces: `ResultQueryDto` with optional `nationalOnly?: boolean` field

- [ ] **Step 1: Add `nationalOnly` field to DTO**

```typescript
  @IsOptional()
  @IsString()
  contest?: string;

  @IsOptional()
  @IsString()
  nationalOnly?: string; // 'true' or undefined — mapped from query param national_only
}
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npm test`
Expected: 17 passed

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/results/dto/result-query.dto.ts
git commit -m "feat: add nationalOnly field to ResultQueryDto"
```

---

### Task 2: Backend Service — add national_only filter in buildQuery()

**Files:**
- Modify: `apps/api/src/modules/results/results.service.ts:195-200` (inside `buildQuery()`)

**Interfaces:**
- Consumes: `ResultQueryDto.nationalOnly` from Task 1
- Produces: SQL that filters to Senator (003*) and Party List (011*) when `nationalOnly` is `'true'`

- [ ] **Step 1: Add national_only filter condition in buildQuery()**

Add after `const where: string[] = [];` inside `buildQuery()`:

```typescript
    const where: string[] = [];
    if (dto.nationalOnly === 'true') {
      where.push(
        "(LPAD(CAST(contest_code AS VARCHAR), 8, '0') LIKE '003%'"
        + " OR LPAD(CAST(contest_code AS VARCHAR), 8, '0') LIKE '011%')"
      );
    }
```

This uses the same prefix logic as `categoryFromCode()`:
- '003' → Senator
- '011' → Party List

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npm test`
Expected: 17 passed

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/results/results.service.ts
git commit -m "feat: add national_only filter to buildQuery"
```

---

### Task 3: Backend Test — verify national_only filter

**Files:**
- Modify: `apps/api/src/modules/results/__tests__/results.service.spec.ts:99` (before closing describe block)

- [ ] **Step 1: Add test for national_only filter**

Add inside the `buildQuery` describe block, after the existing "should add multiple WHERE conditions" test:

```typescript
    it('should add national_only filter for Senator and Party List', () => {
      const { sql } = (service as any).buildQuery({
        level: 'national',
        nationalOnly: 'true',
      });
      expect(sql).toContain("LIKE '003%'");
      expect(sql).toContain("LIKE '011%'");
      expect(sql).toContain('contest_code');
    });

    it('should not add national_only filter when flag is false', () => {
      const { sql } = (service as any).buildQuery({ level: 'national' });
      expect(sql).not.toContain("LIKE '003%'");
      expect(sql).not.toContain("LIKE '011%'");
    });
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: 19 passed (2 new)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/results/__tests__/results.service.spec.ts
git commit -m "test: add tests for national_only filter"
```

---

### Task 4: Frontend — "All" tab, hide dropdown, conditional fetch

**Files:**
- Modify: `apps/web/src/app/results/components/selection-panel.tsx`

**Changes:**

1. **CATEGORY_ORDER**: Prepend `'All'` so it appears first
2. **Default selectedCategory**: Change initial state from `''` to `'All'` (default on load)
3. **Auto-select effect**: Skip when `selectedCategory === 'All'`
4. **Results fetch effect**: Change guard to also fire when `selectedCategory === 'All'` (without contest), send `national_only='true'` when no geography
5. **Contest dropdown**: Only render when `selectedCategory !== 'All'`
6. **Category tab click**: When clicking a non-All category, set selectedContest to '' as before; when clicking "All", also clear selectedContest

- [ ] **Step 1: Update CATEGORY_ORDER and default state**

Add `'All'` at position 0:

```typescript
const CATEGORY_ORDER = [
  'All', 'Senator', 'Party List', 'Governor', 'Vice Governor', 'House of Reps',
  'Provincial Board', 'Mayor', 'Vice Mayor', 'Councilor', 'BARMM Party Rep', 'BARMM Parliament',
];
```

Change default state:
```typescript
const [selectedCategory, setSelectedCategory] = useState<string>('All');
```

Update `fetchContests` — when restoring a category that exists, don't default to first in list if previous was 'All':
```typescript
      setSelectedCategory(prev => {
        if (prev === 'All' && cats.length > 0) return 'All';
        if (cats.includes(prev)) return prev;
        return cats.length > 0 ? cats[0] : '';
      });
```

- [ ] **Step 2: Update auto-select effect to skip when "All"**

```typescript
  useEffect(() => {
    if (selectedCategory === 'All') return;
    const filtered = contestInfos.filter(c => c.category === selectedCategory);
    if (filtered.length === 1 && selectedContest !== filtered[0].code) {
      setSelectedContest(filtered[0].code);
    }
  }, [selectedCategory, contestInfos, selectedContest]);
```

- [ ] **Step 3: Update results fetch effect to handle "All"**

Change the guard at line 150-151:
```typescript
  useEffect(() => {
    if (!selectedContest && selectedCategory !== 'All') return;

    const filters: Record<string, string> = {};

    if (selectedContest) {
      filters.contest = selectedContest;
    } else if (selectedCategory === 'All') {
      // When "All" is active with no geography, only show national contests
      if (!selectedRegion && !selectedProvince && !selectedMunicipality && !selectedBarangay && !selectedVC) {
        filters.national_only = 'true';
      }
    }

    if (selectedVC) {
      filters.level = 'precinct';
      filters.vc = selectedVC;
    } else if (selectedBarangay) {
      filters.level = 'barangay';
      filters.brgy = selectedBarangay;
    } else if (selectedMunicipality) {
      filters.level = 'municipality';
      filters.mun = selectedMunicipality;
    } else if (selectedProvince) {
      filters.level = 'province';
      filters.prv = selectedProvince;
    } else if (selectedRegion) {
      filters.level = 'region';
      filters.reg = selectedRegion;
    } else {
      filters.level = 'national';
    }

    onSelectionChange(filters);
  }, [selectedRegion, selectedProvince, selectedMunicipality, selectedBarangay, selectedVC, selectedContest, selectedCategory, onSelectionChange]);
```

- [ ] **Step 4: Hide contest dropdown when "All" is active**

Change the Contest section at the bottom:
```typescript
          {selectedCategory !== 'All' && (
            <CascadingDropdown
              label="CONTEST"
              options={contestInfos
                .filter(c => c.category === selectedCategory || !selectedCategory)
                .map(c => ({ value: c.code, label: c.name }))}
              value={selectedContest}
              onChange={(e) => setSelectedContest(e.target.value)}
              disabled={contestInfos.length === 0 && !loadingContests}
              loading={loadingContests}
              placeholder={loadingContests ? 'Loading...' : 'Select Contest'}
            />
          )}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit` in `apps/web/`
Expected: No output (clean compile)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/results/components/selection-panel.tsx
git commit -m "feat: add All category tab with conditional results fetch"
```
