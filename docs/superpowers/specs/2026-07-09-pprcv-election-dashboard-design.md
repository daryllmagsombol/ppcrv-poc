# PPCRV Election Results Dashboard - Design Spec

**Date**: 2026-07-09  
**Status**: Draft  
**Stack**: NestJS (backend) + Next.js (frontend) + Prisma (PostgreSQL) + Turborepo (monorepo)

---

## 1. Purpose & Scope

### What We're Building
A public-facing dashboard for viewing Philippine election results, with internal tools for PPCRV volunteers to upload and manage election data.

### Who It's For
- **Primary**: Filipino voters viewing election results publicly
- **Secondary**: PPCRV volunteers uploading and verifying election data

### What It Does
- Display election results at national, regional, provincial, city, and precinct levels
- Regional drill-down navigation
- CSV upload for volunteer data entry
- Snapshot versioning for tracking data updates
- Future: Anomaly detection for suspicious patterns

### What It Doesn't Do (Out of Scope for POC)
- Authentication/authorization
- Real-time updates (manual refresh only)
- Anomaly detection implementation
- Parquet import from existing ETL (designed but not implemented)

---

## 2. Architecture

### High-Level Structure

```
┌─────────────────────────────────────────────────────┐
│                    Turborepo Monorepo                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐         ┌─────────────────────┐   │
│  │   apps/web   │◄───────►│    apps/api         │   │
│  │  (Next.js)   │   REST  │   (NestJS)         │   │
│  └─────────────┘         └─────────────────────┘   │
│         │                          │                │
│         │                          │                │
│         ▼                          ▼                │
│  ┌─────────────────────────────────────────────┐   │
│  │              packages/shared                 │   │
│  │    (Types, DTOs, validation schemas)         │   │
│  └─────────────────────────────────────────────┘   │
│                          │                          │
│                          ▼                          │
│  ┌─────────────────────────────────────────────┐   │
│  │               packages/db                    │   │
│  │    (Prisma client, migrations, schemas)      │   │
│  └─────────────────────────────────────────────┘   │
│                          │                          │
│                          ▼                          │
│                   ┌─────────────┐                   │
│                   │  PostgreSQL │                   │
│                   │ pprcv_local │                   │
│                   └─────────────┘                   │
└─────────────────────────────────────────────────────┘
```

### Design Decisions
- **Vertical Slices**: Feature-based modules (results, upload, snapshots)
- **Monorepo with Turborepo**: Single repo, shared tooling, independent builds
- **REST API**: Simple, well-understood, sufficient for dashboard use case
- **Manual Refresh**: No WebSockets or polling for POC

---

## 3. Data Model

### Existing Tables (in pprcv_local)

```sql
-- Reference data (already exists)
ref_contests     -- contest_code (PK), contest_name
ref_candidates   -- contest_code + candidate_code (PK), candidate_name, parties_code
ref_parties      -- parties_code (PK), parties_name, parties_alias
ref_precincts    -- acm_id (PK), reg_name, prv_name, mun_name, brgy_name, 
                   pollplace, clustered_prec, registered_voters
```

### New Tables (Prisma Schema)

```prisma
model Election {
  id          String   @id @default(cuid())
  name        String   // "2025 National Elections"
  date        DateTime
  status      String   // "active", "completed"
  snapshots   Snapshot[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Snapshot {
  id          String   @id @default(cuid())
  name        String   // "Initial Import", "Updated 2025-05-12"
  electionId  String
  election    Election @relation(fields: [electionId], references: [id])
  source      String   // "csv_upload", "parquet_import"
  fileName    String?
  status      String   // "processing", "completed", "failed"
  records     Int      @default(0)
  results     PrecinctResult[]
  createdAt   DateTime @default(now())
}

model PrecinctResult {
  id              String    @id @default(cuid())
  acmId           String    // FK → ref_precincts.acm_id
  contestCode     String    // FK → ref_contests.contest_code
  snapshotId      String
  snapshot        Snapshot  @relation(fields: [snapshotId], references: [id])
  totalVoters     Int       // copied from ref_precincts.registered_voters
  totalVotesCast  Int
  votes           Vote[]
  createdAt       DateTime  @default(now())

  @@unique([acmId, contestCode, snapshotId])
}

model Vote {
  id                String         @id @default(cuid())
  candidateCode     String         // FK → ref_candidates.candidate_code
  contestCode       String         // FK → ref_candidates.contest_code
  precinctResultId  String
  precinctResult    PrecinctResult @relation(fields: [precinctResultId], references: [id])
  voteCount         Int
  createdAt         DateTime       @default(now())

  @@unique([candidateCode, contestCode, precinctResultId])
}
```

### Location Hierarchy
```
Region (reg_name) → Province (prv_name) → Municipality (mun_name) → Barangay (brgy_name) → Precinct (acm_id)
```

---

## 4. Module Structure

### NestJS Backend (apps/api/src/modules/)

```
modules/
├── elections/
│   ├── elections.controller.ts
│   ├── elections.service.ts
│   └── elections.module.ts
├── results/
│   ├── results.controller.ts
│   ├── results.service.ts
│   ├── results.repository.ts
│   └── results.module.ts
├── upload/
│   ├── upload.controller.ts
│   ├── upload.service.ts
│   ├── csv-parser.service.ts
│   └── upload.module.ts
├── snapshots/
│   ├── snapshots.controller.ts
│   ├── snapshots.service.ts
│   └── snapshots.module.ts
└── anomalies/          # Future: anomaly detection
    └── anomalies.module.ts
```

### Next.js Frontend (apps/web/src/)

```
src/
├── app/
│   ├── page.tsx                    # Homepage - regional overview
│   ├── results/
│   │   ├── page.tsx                # All contests
│   │   └── [contestCode]/
│   │       └── page.tsx            # Contest detail with drill-down
│   └── admin/
│       ├── page.tsx                # Admin dashboard
│       └── upload/
│           └── page.tsx            # CSV upload interface
├── features/
│   ├── results/
│   │   ├── components/
│   │   │   ├── RegionMap.tsx
│   │   │   ├── ResultsTable.tsx
│   │   │   └── DrilldownBreadcrumb.tsx
│   │   ├── hooks/
│   │   │   └── useResults.ts
│   │   └── api/
│   │       └── results.ts
│   └── upload/
│       ├── components/
│       │   ├── FileDropzone.tsx
│       │   └── UploadProgress.tsx
│       └── hooks/
│           └── useUpload.ts
├── components/
│   └── shared/
└── lib/
    ├── api.ts
    └── utils.ts
```

### Shared Package (packages/shared/src/)

```
src/
├── types/
│   ├── election.ts
│   ├── contest.ts
│   ├── candidate.ts
│   ├── precinct.ts
│   └── results.ts
├── schemas/
│   └── csv-validation.ts          # Zod schemas
└── constants/
    └── index.ts
```

---

## 5. API Design

### Endpoints

```
Elections:
  GET    /api/elections                    # List all elections
  POST   /api/elections                    # Create election
  GET    /api/elections/:id                # Get election details

Results (public):
  GET    /api/results/:electionId/overview                     # National overview
  GET    /api/results/:electionId/region/:region               # Region detail
  GET    /api/results/:electionId/province/:province           # Province detail
  GET    /api/results/:electionId/city/:city                   # City detail
  GET    /api/results/:electionId/contest/:contestCode         # Contest by region

Snapshots:
  GET    /api/snapshots                    # List all snapshots
  GET    /api/snapshots/:id                # Get snapshot details

Upload (admin):
  POST   /api/upload/csv                   # Upload CSV file
  GET    /api/upload/status/:jobId         # Check upload status
```

### Query Parameters

```
GET /api/results/:electionId/overview
  ?snapshotId=xxx          # Specific snapshot (default: latest)
  &contestCode=xxx         # Filter by contest

GET /api/results/:electionId/region/:region
  ?contestCode=xxx         # Filter by contest
```

### Response Format

```typescript
// Regional overview response
{
  "election": {
    "id": "cuid",
    "name": "2025 National Elections"
  },
  "snapshot": {
    "id": "cuid",
    "name": "Initial Import",
    "records": 12345
  },
  "contests": [
    {
      "code": "00399000",
      "name": "SENATOR OF PHILIPPINES",
      "level": "national",
      "regions": [
        {
          "name": "NCR",
          "totalVoters": 1234567,
          "totalVotesCast": 987654,
          "turnout": 0.798,
          "candidates": [
            {
              "code": "9900030082",
              "name": "ABALOS, BENHUR",
              "party": "PFP",
              "votes": 12345
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 6. Data Import Flow

### Path 1: CSV Upload

```
Volunteer uploads CSV
       ↓
POST /api/upload/csv
       ↓
upload.service.ts receives file
       ↓
csv-parser.service.ts validates & parses
       ↓
Creates Snapshot (status: "processing")
       ↓
Batch inserts (chunks of 1000):
  - PrecinctResult records
  - Vote records
       ↓
Updates Snapshot (status: "completed", records: count)
```

### CSV Format

```csv
ACM_ID,CONTEST_CODE,CANDIDATE_CODE,VOTE_COUNT
01010001,00399000,9900030082,150
01010001,00399000,9900030040,120
```

### Validation Rules

- ACM_ID must exist in ref_precincts
- CONTEST_CODE must exist in ref_contests
- CANDIDATE_CODE must exist in ref_candidates
- VOTE_COUNT must be non-negative integer
- Duplicates (same ACM_ID + CONTEST_CODE + CANDIDATE_CODE) → error

### Path 2: Parquet Import (Future)

- Designed but not implemented in POC
- Would use duckdb-node or parquet-wasm to read existing ETL outputs
- Same Snapshot and PrecinctResult/Vote table structure

---

## 7. Frontend Design

### Visual Concept: "Balota" (Ballot)

The interface evokes the physical ballot and official election documents—building trust through familiarity with the tangible reality of Philippine elections.

### Color Palette

```
ink-blue:       #1B3A5C   // Official headers, primary text
ballot-cream:   #F8F6F0   // Paper-like backgrounds
stamp-red:      #C41E3A   // Accents, official marks
seal-gold:      #B8860B   // Certification badges
field-gray:     #E8E5DE   // Table rows, card backgrounds
precinct-green: #2D5A3D   // Success states
```

### Typography

```
Display:  "Playfair Display" - Elegant serif for election titles
Body:     "Source Sans 3" - Clean, readable for data
Data:     "JetBrains Mono" - Monospace for vote counts, codes
```

### Signature Element: "The Stamp of Verification"

Every authenticated result displays PPCRV's certification stamp:
- Stamp-red color, slightly rotated (2-3deg)
- Animated "press" effect on page load (0.3s ease-out)
- Respects prefers-reduced-motion

### Page Layouts

**Homepage (Regional Overview)**:
```
┌─────────────────────────────────────────────────────┐
│  ───────────────────────────────────────────────────│
│  SENATOR OF PHILIPPINES                             │
│  2025 National Elections                            │
│  ───────────────────────────────────────────────────│
│                                                     │
│  Contest Selector: [Senator ▼]                      │
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │ REGION          │ VOTES     │ TURNOUT │ LEADING ││
│  ├─────────────────┼───────────┼─────────┼─────────┤│
│  │ NCR             │ 1,234,567 │ 79.8%   │ ...     ││
│  │ CALABARZON      │   987,654 │ 75.2%   │ ...     ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  [PPCRV VERIFIED STAMP]                             │
└─────────────────────────────────────────────────────┘
```

**Drill-Down Page**:
```
┌─────────────────────────────────────────────────────┐
│  Breadcrumb: Home > Senator > NCR > Manila          │
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │ CANDIDATE         │ PARTY  │ VOTES    │ %       ││
│  ├───────────────────┼────────┼──────────┼─────────┤│
│  │ ABALOS, BENHUR    │ PFP    │ 123,456  │ 15.2%   ││
│  │ ADONIS, JEROME    │ MKBYN  │  98,765  │ 12.1%   ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  Drill-Down: [Province ▼] [City ▼] [Precinct ▼]   │
└─────────────────────────────────────────────────────┘
```

**Admin Upload Page**:
```
┌─────────────────────────────────────────────────────┐
│  Admin - Upload Election Data                       │
│                                                     │
│  Election: [2025 National Elections ▼]              │
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │        Drag & Drop CSV File Here                ││
│  │        or [Browse Files]                        ││
│  │                                                 ││
│  │  Expected: ACM_ID, CONTEST_CODE,               ││
│  │  CANDIDATE_CODE, VOTE_COUNT                     ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  Recent Uploads:                                    │
│  ┌─────────────────────────────────────────────────┐│
│  │ Snapshot        │ Records │ Status │ Date       ││
│  ├─────────────────┼─────────┼────────┼────────────┤│
│  │ Initial Import  │ 12,345  │ ✓ Done │ May 12     ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### Component Styling

**Buttons**:
```css
.btn-primary {
  background: #1B3A5C;
  color: #F8F6F0;
  border: 2px solid #1B3A5C;
  font-family: "Source Sans 3";
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.75rem 1.5rem;
}
```

**Tables**:
```css
.results-table {
  border-top: 2px solid #1B3A5C;
  border-bottom: 2px solid #1B3A5C;
}

.results-table th {
  font-family: "Source Sans 3";
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.75rem;
  color: #1B3A5C;
}

.results-table td {
  font-family: "JetBrains Mono";
  font-variant-numeric: tabular-nums;
}

.results-table tr:nth-child(even) {
  background: #E8E5DE;
}
```

### Motion

**Page Load**:
1. Header fades in (0.2s)
2. Stats counters animate up (0.4s)
3. Stamp verification presses down (0.3s, delayed 0.5s)
4. Table rows stagger in (0.1s each)

**Reduced Motion**: All animations disabled.

### Responsive

- **Mobile (< 768px)**: Tables become card stacks
- **Tablet (768-1024px)**: Tables compact
- **Desktop (> 1024px)**: Full layout

---

## 8. Future Features (Not in POC)

- **Authentication**: Email/password for volunteers, role-based access
- **Anomaly Detection**: Statistical outliers, data integrity issues, suspicious patterns
- **Parquet Import**: Read existing ETL outputs directly
- **Real-time Updates**: WebSockets or polling
- **Dark Mode**: CSS custom properties ready
- **Snapshot Comparison**: Side-by-side data comparison
- **Data Export**: CSV/Excel export for reports

---

## 9. Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo | Turborepo | Shared tooling, independent builds |
| Backend | NestJS | Modular, TypeScript, well-documented |
| Frontend | Next.js | SSR, file-based routing, React ecosystem |
| ORM | Prisma | Type-safe, migration management |
| Database | PostgreSQL (ppcrv_local) | Existing reference data |
| API Style | REST | Simple, sufficient for dashboard |
| Module Pattern | Vertical Slices | Feature-based, easy to extend |
| Auth | None (POC) | Design for future, don't implement now |
| Updates | Manual Refresh | Simple, add polling/WebSockets later |
