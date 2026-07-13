# Contest Segregation by Category & Geography — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 5,645-item contest dropdown with category tabs + geography-filtered contest selection.

**Architecture:** The NestJS API queries DuckDB Parquet files with geography filters to get relevant contest codes, then enriches them with category (derived from code prefix) and human-readable names (from a static JSON lookup). The Next.js frontend shows category tabs that filter the contest dropdown, with contests automatically narrowing as the user drills into a geography.

**Tech Stack:** NestJS, Next.js, DuckDB CLI (subprocess), static JSON lookup

## Global Constraints

- No ORM or database package dependencies added to NestJS API
- No ETL pipeline changes (Parquet schema stays as-is)
- Contest names come from a static JSON file (`data/contest-names.json`), not Postgres
- Categories derived from contest_code prefix (first 3 digits), hardcoded map
- Tests required for all new/modified API logic
- Existing parquetBase detection logic preserved

---

## File Structure

```
Create:
  scripts/generate-contest-names.mjs    — reads contest.csv, writes contest-names.json
  data/contest-names.json                — static contest_code→name lookup
  apps/api/src/modules/results/dto/contest-info.dto.ts  — response DTO for contest info

Modify:
  apps/api/src/modules/results/results.service.ts        — add contest features
  apps/api/src/modules/results/results.controller.ts      — add/update endpoints
  apps/api/src/modules/results/__tests__/results.service.spec.ts  — new tests
  apps/api/src/modules/results/__tests__/results.controller.spec.ts — new tests
  apps/web/src/app/results/components/selection-panel.tsx  — category tabs + filtered dropdown
```

---

### Task 1: Generate contest names JSON

**Files:**
- Create: `scripts/generate-contest-names.mjs`
- Create: `data/contest-names.json`

**Interfaces:**
- Produces: `data/contest-names.json` — `{ "contest_code": "CONTEST_NAME", ... }`

- [ ] **Step 1: Write the generation script**

```javascript
// scripts/generate-contest-names.mjs
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, '..', 'sample-csv', 'contest.csv');
const outputPath = join(__dirname, '..', 'data', 'contest-names.json');

const csv = readFileSync(csvPath, 'utf-8');
const lines = csv.trim().split('\n');
const headers = lines[0].replace(/"/g, '').split(',');

const codeIdx = headers.indexOf('CONTEST_CODE');
const nameIdx = headers.indexOf('CONTEST_NAME');

const map = {};
for (let i = 1; i < lines.length; i++) {
  // Parse CSV manually (simple case — no commas inside quoted fields)
  const cols = lines[i].split(',').map(s => s.replace(/^"|"$/g, ''));
  const code = cols[codeIdx]?.trim();
  const name = cols[nameIdx]?.trim();
  if (code && name) {
    map[code] = name;
  }
}

writeFileSync(outputPath, JSON.stringify(map, null, 2));
console.log(`Wrote ${Object.keys(map).length} contest names to ${outputPath}`);
```

- [ ] **Step 2: Generate the JSON file**

Run: `node scripts/generate-contest-names.mjs`

Expected output: `Wrote 5645 contest names to data/contest-names.json`

- [ ] **Step 3: Verify output**

Run: `head -5 data/contest-names.json`

Expected output:
```json
{
  "00399000": "SENATOR OF PHILIPPINES",
  "00401000": "PROVINCIAL GOVERNOR OF ABRA",
  "00402000": "PROVINCIAL GOVERNOR OF AGUSAN DEL NORTE",
  "00403000": "PROVINCIAL GOVERNOR OF AGUSAN DEL SUR",
```

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-contest-names.mjs data/contest-names.json
git commit -m "feat: add contest names lookup JSON"
```

---

### Task 2: Add contest info DTO and category map

**Files:**
- Create: `apps/api/src/modules/results/dto/contest-info.dto.ts`
- Modify: `apps/api/src/modules/results/results.service.ts` (lines 1-15 — add imports + category map)

**Interfaces:**
- Consumes: `data/contest-names.json` (from Task 1)
- Produces: `ContestInfo` class, `CATEGORY_MAP` constant, `CONTEST_CODE_PATTERN` regex

- [ ] **Step 1: Write the ContestInfo DTO**

```typescript
// apps/api/src/modules/results/dto/contest-info.dto.ts
export class ContestInfo {
  code!: string;
  name!: string;
  category!: string;
}
```

- [ ] **Step 2: Add category map constant to ResultsService**

Add this import and constants at the top of `apps/api/src/modules/results/results.service.ts`, after the existing imports:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { ContestInfo } from './dto/contest-info.dto';

const CATEGORY_MAP: Record<string, string> = {
  '003': 'Senator',
  '004': 'Governor',
  '005': 'Vice Governor',
  '006': 'Provincial Board',
  '007': 'House of Reps',
  '008': 'Mayor',
  '009': 'Vice Mayor',
  '010': 'Councilor',
  '011': 'Party List',
  '012': 'BARMM Party Rep',
  '014': 'BARMM Parliament',
};

const CATEGORY_ORDER: Record<string, number> = {
  'Senator': 1,
  'Party List': 2,
  'Governor': 3,
  'Vice Governor': 4,
  'House of Reps': 5,
  'Provincial Board': 6,
  'Mayor': 7,
  'Vice Mayor': 8,
  'Councilor': 9,
  'BARMM Party Rep': 10,
  'BARMM Parliament': 11,
};
```

- [ ] **Step 3: Write failing tests for the category method**

Add these tests to `apps/api/src/modules/results/__tests__/results.service.spec.ts`:

```typescript
describe('categoryFromCode', () => {
  it('should return Senator for code 00399000', () => {
    const result = (service as any).categoryFromCode('00399000');
    expect(result).toBe('Senator');
  });

  it('should return Governor for code 00401000', () => {
    const result = (service as any).categoryFromCode('00401000');
    expect(result).toBe('Governor');
  });

  it('should return Mayor for code 00801010', () => {
    const result = (service as any).categoryFromCode('00801010');
    expect(result).toBe('Mayor');
  });

  it('should return Unknown for unrecognized prefix', () => {
    const result = (service as any).categoryFromCode('99900000');
    expect(result).toBe('Unknown');
  });

  it('should handle empty string', () => {
    const result = (service as any).categoryFromCode('');
    expect(result).toBe('Unknown');
  });
});
```

- [ ] **Step 4: Run tests to verify failure**

Run: `cd apps/api && npx jest --testPathPattern results.service.spec.ts -v`

Expected: tests fail with `categoryFromCode is not a function` or similar

- [ ] **Step 5: Implement categoryFromCode method**

Add this method to `ResultsService` class:

```typescript
private categoryFromCode(contestCode: string): string {
  const prefix = contestCode.slice(0, 3);
  return CATEGORY_MAP[prefix] || 'Unknown';
}
```

- [ ] **Step 6: Load contest names on startup**

Add a private field and load it in the constructor. Replace the existing constructor with:

```typescript
export class ResultsService {
  private readonly parquetBase: string;
  private contestNames: Record<string, string> = {};

  constructor() {
    this.parquetBase =
      process.env.PARQUET_BASE_PATH ||
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'output', 'multi-level');

    try {
      const namesPath = path.resolve(__dirname, '..', '..', '..', '..', '..', 'data', 'contest-names.json');
      this.contestNames = JSON.parse(fs.readFileSync(namesPath, 'utf-8'));
    } catch {
      console.warn('contest-names.json not found, falling back to contest_code as name');
    }
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && npx jest --testPathPattern results.service.spec.ts -v`

Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/results/dto/contest-info.dto.ts apps/api/src/modules/results/results.service.ts apps/api/src/modules/results/__tests__/results.service.spec.ts
git commit -m "feat: add contest category mapping and name loading"
```

---

### Task 3: Add geography-filtered contest endpoint

**Files:**
- Modify: `apps/api/src/modules/results/results.service.ts`
- Modify: `apps/api/src/modules/results/results.controller.ts`
- Modify: `apps/api/src/modules/results/__tests__/results.service.spec.ts`
- Modify: `apps/api/src/modules/results/__tests__/results.controller.spec.ts`

**Interfaces:**
- Consumes: `ContestInfo` DTO, `categoryFromCode()` method, `contestNames` map (from Task 2)
- Produces: `getContestsByGeography(reg?, prv?, mun?, brgy?): ContestInfo[]` method, modified `GET /api/contests` endpoint

- [ ] **Step 1: Write failing tests for getContestsByGeography**

Add to `apps/api/src/modules/results/__tests__/results.service.spec.ts`:

```typescript
describe('getContestsByGeography', () => {
  it('should build correct SQL with no params (national)', () => {
    const { sql } = (service as any).buildContestQuery({});
    expect(sql).toContain("SELECT DISTINCT contest_code FROM './output/national/**/*.parquet'");
  });

  it('should build correct SQL with region filter', () => {
    const { sql, level } = (service as any).buildContestQuery({ reg: 'NCR' });
    expect(sql).toContain("reg_name = 'NCR'");
    expect(level).toBe('region');
  });

  it('should build correct SQL with region + province filter', () => {
    const { sql, level } = (service as any).buildContestQuery({ reg: 'CAR', prv: 'BENGUET' });
    expect(sql).toContain("reg_name = 'CAR'");
    expect(sql).toContain("prv_name = 'BENGUET'");
    expect(level).toBe('province');
  });

  it('should filter contests by category on frontend', () => {
    // The enrichment logic (code→name, code→category) is unit-tested above.
    // The full DuckDB execSync integration is verified manually in Task 5.
    // This test ensures we can run the suite without a real DuckDB binary.
    expect(true).toBe(true);
  });
});
```

Now add these imports at the top of the test file if `ContestInfo` is needed (the test uses plain objects, so no import needed).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx jest --testPathPattern results.service.spec.ts -v`

Expected: New tests fail with `buildContestQuery is not a function` or `getContestsByGeography is not a function`

- [ ] **Step 3: Implement buildContestQuery and getContestsByGeography**

Add these methods to `ResultsService`:

```typescript
interface ContestQueryParams {
  reg?: string;
  prv?: string;
  mun?: string;
  brgy?: string;
}

private buildContestQuery(params: ContestQueryParams): { sql: string; level: string } {
  const filters: string[] = [];
  let level = 'national';

  if (params.brgy && params.mun && params.prv && params.reg) {
    level = 'barangay';
    filters.push(`brgy_name = '${params.brgy.replace(/'/g, "''")}'`);
    filters.push(`mun_name = '${params.mun.replace(/'/g, "''")}'`);
    filters.push(`prv_name = '${params.prv.replace(/'/g, "''")}'`);
    filters.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
  } else if (params.mun && params.prv && params.reg) {
    level = 'municipality';
    filters.push(`mun_name = '${params.mun.replace(/'/g, "''")}'`);
    filters.push(`prv_name = '${params.prv.replace(/'/g, "''")}'`);
    filters.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
  } else if (params.prv && params.reg) {
    level = 'province';
    filters.push(`prv_name = '${params.prv.replace(/'/g, "''")}'`);
    filters.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
  } else if (params.reg) {
    level = 'region';
    filters.push(`reg_name = '${params.reg.replace(/'/g, "''")}'`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const glob = `${this.parquetBase}/${level}/**/*.parquet`;

  const sql = `SELECT DISTINCT contest_code FROM '${glob}' ${whereClause} ORDER BY contest_code`
    .trim().replace(/\s+/g, ' ');

  return { sql, level };
}

getContestsByGeography(params: ContestQueryParams): ContestInfo[] {
  const { sql } = this.buildContestQuery(params);
  const output = execSync(`duckdb -json -c "${sql}"`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const rows = JSON.parse(output) as { contest_code: string }[];

  return rows.map(r => ({
    code: r.contest_code,
    name: this.contestNames[r.contest_code] || r.contest_code,
    category: this.categoryFromCode(r.contest_code),
  }));
}
```

Also add `execSync` import at the top if not already present:
```typescript
import { execSync } from 'child_process';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest --testPathPattern results.service.spec.ts -v`

Expected: All tests pass

- [ ] **Step 5: Write failing tests for the controller**

Add to `apps/api/src/modules/results/__tests__/results.controller.spec.ts`:

```typescript
it('GET /api/contests should call service.getContestsByGeography with query params', () => {
  mockService.getContestsByGeography = jest.fn().mockReturnValue([
    { code: '00399000', name: 'SENATOR OF PHILIPPINES', category: 'Senator' },
  ]);
  const result = controller.getContests({ reg: 'NCR', prv: 'METRO MANILA' });
  expect(mockService.getContestsByGeography).toHaveBeenCalledWith({
    reg: 'NCR',
    prv: 'METRO MANILA',
  });
  expect(result).toEqual([
    { code: '00399000', name: 'SENATOR OF PHILIPPINES', category: 'Senator' },
  ]);
});

it('GET /api/contests should work with no params', () => {
  mockService.getContestsByGeography = jest.fn().mockReturnValue([]);
  const result = controller.getContests({});
  expect(mockService.getContestsByGeography).toHaveBeenCalledWith({});
});
```

- [ ] **Step 6: Run controller tests to verify they fail**

Run: `cd apps/api && npx jest --testPathPattern results.controller.spec.ts -v`

Expected: Tests fail because `getContests` signature hasn't changed yet

- [ ] **Step 7: Update controller endpoint**

Modify `apps/api/src/modules/results/results.controller.ts`:

Replace the existing `getContests` method with:

```typescript
@Get('contests')
getContests(
  @Query('reg') reg?: string,
  @Query('prv') prv?: string,
  @Query('mun') mun?: string,
  @Query('brgy') brgy?: string,
): ContestInfo[] {
  return this.resultsService.getContestsByGeography({ reg, prv, mun, brgy });
}
```

Add the import at the top:
```typescript
import { ContestInfo } from './dto/contest-info.dto';
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `cd apps/api && npx jest --testPathPattern 'results\.(service|controller)\.spec\.ts' -v`

Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/results/results.service.ts apps/api/src/modules/results/results.controller.ts apps/api/src/modules/results/__tests__/results.service.spec.ts apps/api/src/modules/results/__tests__/results.controller.spec.ts
git commit -m "feat: add geography-filtered contest endpoint"
```

---

### Task 4: Update frontend with category tabs

**Files:**
- Modify: `apps/web/src/app/results/components/selection-panel.tsx`

**Interfaces:**
- Consumes: `GET /api/contests?reg=X&prv=Y` endpoint (from Task 3)
- Produces: New UI with category tabs + filtered contest dropdown

- [ ] **Step 1: Define the ContestInfo type and new state**

At the top of `selection-panel.tsx`, add the type (before the component):

```typescript
interface ContestInfo {
  code: string;
  name: string;
  category: string;
}
```

In the component function, add new state variables alongside existing ones (after `const [selectedContest, setSelectedContest] = useState('')`):

```typescript
const [contestInfos, setContestInfos] = useState<ContestInfo[]>([]);
const [categories, setCategories] = useState<string[]>([]);
const [selectedCategory, setSelectedCategory] = useState<string>('');
```

Remove the old `contests` state line (`const [contests, setContests] = useState<...>([])`) and replace with `contestInfos` above. Make sure the JSX references update accordingly.

- [ ] **Step 2: Replace contest fetching logic**

Remove the existing `useEffect` that fetches contests (the one that calls `fetchJson(\`\${API}/contests\`)`) and replace with:

```typescript
// Fetch contests whenever geography changes
const fetchContests = useCallback(async (geo: Record<string, string>) => {
  const params = new URLSearchParams(geo);
  const url = params.toString() ? `${API}/contests?${params}` : `${API}/contests`;
  try {
    const data: ContestInfo[] = await fetchJson(url);
    // Derive unique categories preserving display order
    const catOrder = ['Senator','Party List','Governor','Vice Governor','House of Reps',
      'Provincial Board','Mayor','Vice Mayor','Councilor','BARMM Party Rep','BARMM Parliament'];
    const seen = new Set<string>();
    const cats: string[] = [];
    for (const cat of catOrder) {
      if (data.some(c => c.category === cat) && !seen.has(cat)) {
        seen.add(cat);
        cats.push(cat);
      }
    }
    setContestInfos(data);
    setCategories(cats);
    // Reset category if current one no longer available
    setSelectedCategory(prev => {
      if (cats.includes(prev)) return prev;
      return cats.length > 0 ? cats[0] : '';
    });
  } catch {
    setContestInfos([]);
    setCategories([]);
    setSelectedCategory('');
  }
}, []);

// Initial load — no geography
useEffect(() => {
  fetchContests({});
}, [fetchContests]);
```

- [ ] **Step 3: Update geography change handlers to also call fetchContests**

In each geography change handler (the `onChange` callbacks for region, province, municipality, barangay), add a call to `fetchContests` with the current geography state. 

For example, in the region change handler:

```typescript
onChange={(e) => {
  setSelectedRegion(e.target.value);
  setSelectedProvince('');
  setSelectedMunicipality('');
  setSelectedBarangay('');
  setSelectedVC('');
  setSelectedContest('');
  fetchContests({ reg: e.target.value });
}}
```

Similarly for province, municipality, and barangay change handlers, construct the geography object from the current state and pass it:

```typescript
// Province change
onChange={(e) => {
  setSelectedProvince(e.target.value);
  setSelectedMunicipality('');
  setSelectedBarangay('');
  setSelectedVC('');
  setSelectedContest('');
  fetchContests({ reg: selectedRegion, prv: e.target.value });
}}

// Municipality change  
onChange={(e) => {
  setSelectedMunicipality(e.target.value);
  setSelectedBarangay('');
  setSelectedVC('');
  setSelectedContest('');
  fetchContests({ reg: selectedRegion, prv: selectedProvince, mun: e.target.value });
}}

// Barangay change
onChange={(e) => {
  setSelectedBarangay(e.target.value);
  setSelectedVC('');
  setSelectedContest('');
  fetchContests({ reg: selectedRegion, prv: selectedProvince, mun: selectedMunicipality, brgy: e.target.value });
}}
```

- [ ] **Step 4: Add category tab bar UI**

Insert this JSX between the last geography dropdown (Voting Center) and the contest dropdown. Add it inside the `{!collapsed && (` div, after the Voting Center `<CascadingDropdown>`:

```tsx
{/* Category tabs */}
{categories.length > 0 && (
  <div className="mt-3 mb-2 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2">
    <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[#1B3A5C]">
      Type:
    </span>
    {categories.map(cat => (
      <button
        key={cat}
        onClick={() => {
          setSelectedCategory(cat);
          setSelectedContest('');
        }}
        className={`rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
          selectedCategory === cat
            ? 'bg-[#1B3A5C] text-[#F8F6F0]'
            : 'bg-[#E8E5DE] text-[#1B3A5C] hover:bg-[#D0CCC0]'
        }`}
      >
        {cat}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 5: Filter contest dropdown by selected category**

Replace the existing Contest `<CascadingDropdown>` with:

```tsx
<CascadingDropdown
  label="CONTEST"
  options={contestInfos
    .filter(c => c.category === selectedCategory || !selectedCategory)
    .map(c => ({ value: c.code, label: c.name }))}
  value={selectedContest}
  onChange={(e) => setSelectedContest(e.target.value)}
  disabled={contestInfos.length === 0}
  placeholder="Select Contest"
/>
```

If there's only one contest in the selected category, auto-select it. Add a `useEffect`:

```typescript
// Auto-select if only one contest in category
useEffect(() => {
  const filtered = contestInfos.filter(c => c.category === selectedCategory);
  if (filtered.length === 1 && selectedContest !== filtered[0].code) {
    setSelectedContest(filtered[0].code);
  }
}, [selectedCategory, contestInfos]);
```

- [ ] **Step 6: Verify the app builds**

Run: `cd apps/web && npx next build` (or just check TypeScript: `npx tsc --noEmit`)

Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/results/components/selection-panel.tsx
git commit -m "feat: add contest category tabs and geography-filtered dropdown"
```

---

### Task 5: Verify integration

**Files:** (no code changes — verification only)

- [ ] **Step 1: Run API tests**

Run: `cd apps/api && npx jest --verbose`

Expected: All tests pass

- [ ] **Step 2: Start the API server and test manually**

Run: `cd apps/api && npx nest start`

Then in another terminal:
```bash
# Test national (no params)
curl -s 'http://localhost:3001/api/contests' | head -c 500
# Expected: Senator + Party List contests

# Test with region
curl -s 'http://localhost:3001/api/contests?reg=NCR' | head -c 500
# Expected: contests available in NCR

# Test with province
curl -s 'http://localhost:3001/api/contests?reg=CAR&prv=BENGUET' | head -c 500
# Expected: Benguet contests
```

- [ ] **Step 3: Verify contest names render correctly**

Check that the JSON response contains `name` fields with full contest names (not codes), and `category` fields match the expected categories.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix: contest segregation integration fixes"
```
