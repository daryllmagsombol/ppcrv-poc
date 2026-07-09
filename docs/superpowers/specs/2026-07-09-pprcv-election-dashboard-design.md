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

Following NestJS best practices:
- **Feature modules** (not technical layers)
- **Repository pattern** for database abstraction
- **Constructor injection** (not property injection)
- **Exception filters** for centralized error handling
- **DTOs with class-validator** for input validation
- **Interceptors** for cross-cutting concerns

```
modules/
├── elections/
│   ├── dto/
│   │   ├── create-election.dto.ts
│   │   └── election-response.dto.ts
│   ├── elections.controller.ts
│   ├── elections.service.ts
│   ├── elections.repository.ts
│   ├── elections.module.ts
│   └── __tests__/
│       ├── elections.service.spec.ts
│       └── elections.controller.spec.ts
├── results/
│   ├── dto/
│   │   ├── result-query.dto.ts
│   │   └── region-results.dto.ts
│   ├── results.controller.ts
│   ├── results.service.ts
│   ├── results.repository.ts
│   ├── results.module.ts
│   └── __tests__/
├── upload/
│   ├── dto/
│   │   ├── upload-csv.dto.ts
│   │   └── upload-status.dto.ts
│   ├── upload.controller.ts
│   ├── upload.service.ts
│   ├── csv-parser.service.ts
│   ├── upload.repository.ts
│   ├── upload.module.ts
│   └── __tests__/
├── snapshots/
│   ├── dto/
│   ├── snapshots.controller.ts
│   ├── snapshots.service.ts
│   ├── snapshots.repository.ts
│   ├── snapshots.module.ts
│   └── __tests__/
├── common/
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   └── transform.interceptor.ts
│   ├── pipes/
│   │   └── validation.pipe.ts
│   └── guards/
│       └── (future: auth guards)
└── anomalies/          # Future: anomaly detection
    └── anomalies.module.ts
```

### Next.js Frontend (apps/web/src/)

Following Next.js best practices:
- **App Router** with Server Components by default
- **'use client'** only when needed (interactive components)
- **Server Actions** for mutations (upload)
- **Route Handlers** for API proxy only
- **Proper error boundaries** (error.tsx, not-found.tsx)
- **Metadata** for SEO
- **next/image** for all images
- **next/font** for typography

```
src/
├── app/
│   ├── layout.tsx                  # Root layout with fonts
│   ├── page.tsx                    # Homepage - regional overview (Server Component)
│   ├── loading.tsx                 # Loading UI
│   ├── error.tsx                   # Error boundary
│   ├── not-found.tsx               # 404 page
│   ├── results/
│   │   ├── page.tsx                # All contests (Server Component)
│   │   └── [contestCode]/
│   │       ├── page.tsx            # Contest detail (Server Component)
│   │       └── loading.tsx         # Loading state
│   └── admin/
│       ├── layout.tsx              # Admin layout
│       ├── page.tsx                # Admin dashboard
│       └── upload/
│           └── page.tsx            # CSV upload (Client Component)
├── features/
│   ├── results/
│   │   ├── components/
│   │   │   ├── RegionMap.tsx       # 'use client' - interactive map
│   │   │   ├── ResultsTable.tsx    # Server Component
│   │   │   └── DrilldownBreadcrumb.tsx  # Server Component
│   │   ├── actions/
│   │   │   └── results.ts         # Server Actions for data fetching
│   │   └── utils/
│   │       └── format.ts          # Number formatting
│   └── upload/
│       ├── components/
│       │   ├── FileDropzone.tsx    # 'use client' - drag & drop
│       │   └── UploadProgress.tsx  # 'use client' - progress bar
│       └── actions/
│           └── upload.ts          # Server Actions for CSV upload
├── components/
│   └── shared/
│       ├── Header.tsx              # Server Component
│       ├── Footer.tsx              # Server Component
│       ├── StampVerification.tsx   # 'use client' - animation
│       └── ContestSelector.tsx     # 'use client' - dropdown
├── lib/
│   ├── api.ts                      # API client (fetch wrapper)
│   └── utils.ts                    # Utility functions
└── styles/
    └── globals.css                 # Tailwind + custom CSS
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

## 9. NestJS Best Practices Implementation

### Architecture Rules

**arch-feature-modules**: Each module (elections, results, upload, snapshots) is self-contained with its own controller, service, repository, DTOs, and tests.

**arch-use-repository-pattern**: Database logic abstracted in repository classes for testability:
```typescript
// results.repository.ts
@Injectable()
export class ResultsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findRegionalOverview(electionId: string, snapshotId: string) {
    return this.prisma.precinctResult.groupBy({
      by: ['acmId'],
      where: { snapshotId },
      _sum: { totalVotesCast: true }
    });
  }
}
```

**arch-single-responsibility**: Services focused on one concern:
- `ResultsService` - Aggregates and formats results
- `UploadService` - Handles CSV parsing and validation
- `SnapshotsService` - Manages snapshot lifecycle

### Dependency Injection Rules

**di-prefer-constructor-injection**: All dependencies injected via constructor:
```typescript
@Injectable()
export class ResultsService {
  constructor(
    private readonly resultsRepository: ResultsRepository,
    private readonly prisma: PrismaService,
  ) {}
}
```

**di-interface-segregation**: Use injection tokens for interfaces:
```typescript
export const RESULTS_REPOSITORY = 'RESULTS_REPOSITORY';

@Module({
  providers: [
    { provide: RESULTS_REPOSITORY, useClass: ResultsRepository },
  ],
})
export class ResultsModule {}
```

### Error Handling Rules

**error-use-exception-filters**: Global exception filter for consistent error responses:
```typescript
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    response.status(status).json({
      statusCode: status,
      message: typeof exceptionResponse === 'string' 
        ? exceptionResponse 
        : (exceptionResponse as any).message,
      timestamp: new Date().toISOString(),
    });
  }
}
```

**error-throw-http-exceptions**: Use NestJS HTTP exceptions:
```typescript
// Good
throw new NotFoundException(`Election ${id} not found`);
throw new BadRequestException('Invalid CSV format');

// Bad
throw new Error('Not found');
```

### Security Rules

**security-validate-all-input**: DTOs with class-validator:
```typescript
export class UploadCsvDto {
  @IsNotEmpty()
  @IsString()
  electionId: string;

  @IsNotEmpty()
  @IsString()
  snapshotName: string;
}

export class ResultQueryDto {
  @IsOptional()
  @IsString()
  snapshotId?: string;

  @IsOptional()
  @IsString()
  contestCode?: string;
}
```

**security-rate-limiting**: Rate limiting on upload endpoint:
```typescript
@Controller('upload')
@UseInterceptors(ThrottleInterceptor)
export class UploadController {
  @Post('csv')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 uploads per minute
  async uploadCsv(@Body() dto: UploadCsvDto, @UploadedFile() file: Express.Multer.File) {
    // ...
  }
}
```

### Performance Rules

**perf-optimize-database**: Avoid N+1 queries with includes:
```typescript
// Good - single query with relations
async findRegionalOverview(electionId: string) {
  return this.prisma.precinctResult.findMany({
    where: { snapshot: { electionId } },
    include: {
      votes: {
        include: { candidate: true }
      },
      precinct: true
    }
  });
}

// Bad - N+1 queries
async findRegionalOverview(electionId: string) {
  const results = await this.prisma.precinctResult.findMany();
  for (const result of results) {
    result.votes = await this.prisma.vote.findMany({ where: { precinctResultId: result.id } });
  }
}
```

**perf-use-caching**: Cache reference data:
```typescript
@Injectable()
export class ResultsService {
  constructor(
    private readonly cacheManager: Cache,
    private readonly resultsRepository: ResultsRepository,
  ) {}

  async getRegionalOverview(electionId: string) {
    const cacheKey = `results:overview:${electionId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const results = await this.resultsRepository.findRegionalOverview(electionId);
    await this.cacheManager.set(cacheKey, results, 300); // 5 min TTL
    return results;
  }
}
```

### Database Rules

**db-use-transactions**: Transaction support for CSV upload:
```typescript
async processCsvUpload(file: Express.Multer.File, dto: UploadCsvDto) {
  return this.prisma.$transaction(async (prisma) => {
    const snapshot = await prisma.snapshot.create({
      data: { name: dto.snapshotName, electionId: dto.electionId, status: 'processing' }
    });

    const rows = await this.csvParser.parse(file);
    const validated = await this.csvParser.validate(rows);

    for (const chunk of chunkArray(validated, 1000)) {
      await this.insertChunk(chunk, snapshot.id, prisma);
    }

    return prisma.snapshot.update({
      where: { id: snapshot.id },
      data: { status: 'completed', records: validated.length }
    });
  });
}
```

**db-use-migrations**: Use Prisma migrations for schema changes:
```bash
npx prisma migrate dev --name add-election-tables
npx prisma migrate deploy
```

### API Design Rules

**api-use-dto-serialization**: DTOs for request/response:
```typescript
export class RegionResultsDto {
  @Expose()
  name: string;

  @Expose()
  totalVoters: number;

  @Expose()
  totalVotesCast: number;

  @Expose()
  turnout: number;

  @Expose()
  candidates: CandidateResultDto[];
}
```

**api-use-interceptors**: Transform interceptor for consistent response format:
```typescript
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map(data => ({
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

### Testing Rules

**test-use-testing-module**: Use NestJS testing utilities:
```typescript
describe('ResultsService', () => {
  let service: ResultsService;
  let repository: ResultsRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ResultsService,
        { provide: ResultsRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get<ResultsService>(ResultsService);
    repository = module.get<ResultsRepository>(ResultsRepository);
  });

  it('should return regional overview', async () => {
    jest.spyOn(repository, 'findRegionalOverview').mockResolvedValue(mockResults);
    const result = await service.getRegionalOverview('election-id');
    expect(result).toBeDefined();
  });
});
```

---

## 10. Next.js Best Practices Implementation

### File Conventions

**app-router-structure**: Use App Router with proper route segments:
```
app/
├── page.tsx                    # Route: /
├── results/
│   ├── page.tsx                # Route: /results
│   └── [contestCode]/
│       └── page.tsx            # Route: /results/:contestCode
└── admin/
    └── upload/
        └── page.tsx            # Route: /admin/upload
```

**error-boundaries**: Each route segment has error handling:
```typescript
// app/results/error.tsx
'use client'

export default function ResultsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="error-container">
      <h2>Something went wrong loading results</h2>
      <button onClick={() => reset()}>Try again</button>
    </div>
  )
}
```

**loading-states**: Loading UI for each route:
```typescript
// app/results/loading.tsx
export default function ResultsLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3 mb-4" />
      <div className="h-64 bg-gray-200 rounded" />
    </div>
  )
}
```

### RSC Boundaries

**server-components-default**: Pages and layouts are Server Components:
```typescript
// app/results/page.tsx (Server Component - no 'use client')
import { getRegionalOverview } from '@/features/results/actions/results'
import { ResultsTable } from '@/features/results/components/ResultsTable'

export default async function ResultsPage() {
  const data = await getRegionalOverview()
  
  return (
    <main>
      <h1>Election Results</h1>
      <ResultsTable data={data} />
    </main>
  )
}
```

**client-components-when-needed**: Only use 'use client' for interactivity:
```typescript
// features/results/components/RegionMap.tsx
'use client'

import { useState } from 'react'

export function RegionMap({ regions }: { regions: Region[] }) {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  
  return (
    <div>
      {/* Interactive map implementation */}
    </div>
  )
}
```

**serializable-props**: Server Components pass serializable data to Client Components:
```typescript
// Good - serializable data
<ResultsTable data={JSON.parse(JSON.stringify(results))} />

// Bad - non-serializable (functions, classes)
<ResultsTable formatter={new Intl.NumberFormat()} />
```

### Async Patterns

**async-params**: Dynamic route params are async in Next.js 15+:
```typescript
// app/results/[contestCode]/page.tsx
export default async function ContestPage({
  params,
}: {
  params: Promise<{ contestCode: string }>
}) {
  const { contestCode } = await params
  const results = await getContestResults(contestCode)
  
  return <ContestDetail results={results} />
}
```

**async-searchparams**: Search params are also async:
```typescript
export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ snapshotId?: string }>
}) {
  const { snapshotId } = await searchParams
  // ...
}
```

### Data Patterns

**avoid-waterfalls**: Use Promise.all for parallel data fetching:
```typescript
// Good - parallel
const [elections, contests, snapshots] = await Promise.all([
  getElections(),
  getContests(),
  getSnapshots(),
])

// Bad - waterfall
const elections = await getElections()
const contests = await getContests()
const snapshots = await getSnapshots()
```

**server-actions-for-mutations**: Use Server Actions for form submissions:
```typescript
// features/upload/actions/upload.ts
'use server'

import { revalidatePath } from 'next/cache'

export async function uploadCsv(formData: FormData) {
  const file = formData.get('file') as File
  const electionId = formData.get('electionId') as string
  
  // Validate and process
  const result = await processUpload(file, electionId)
  
  revalidatePath('/admin/upload')
  return { success: true, snapshotId: result.id }
}
```

### Metadata

**dynamic-metadata**: Use generateMetadata for dynamic pages:
```typescript
// app/results/[contestCode]/page.tsx
export async function generateMetadata({
  params,
}: {
  params: Promise<{ contestCode: string }>
}): Promise<Metadata> {
  const { contestCode } = await params
  const contest = await getContest(contestCode)
  
  return {
    title: `${contest.name} - PPCRV Election Results`,
    description: `View results for ${contest.name} in the 2025 Philippine Elections`,
  }
}
```

### Image Optimization

**next-image**: Always use next/image for images:
```typescript
import Image from 'next/image'

// Good
<Image
  src="/ppcrv-logo.png"
  alt="PPCRV Logo"
  width={200}
  height={100}
  priority  // LCP image
/>

// Bad
<img src="/ppcrv-logo.png" alt="PPCRV Logo" />
```

### Font Optimization

**next-font**: Load fonts with next/font:
```typescript
// app/layout.tsx
import { Playfair_Display, Source_Sans_3, JetBrains_Mono } from 'next/font/google'

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
})

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-body',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-data',
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${sourceSans.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

### CSS/Styling

**tailwind-css**: Use Tailwind CSS with custom CSS variables:
```css
/* styles/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --ink-blue: #1B3A5C;
  --ballot-cream: #F8F6F0;
  --stamp-red: #C41E3A;
  --seal-gold: #B8860B;
  --field-gray: #E8E5DE;
  --precinct-green: #2D5A3D;
}

body {
  font-family: var(--font-body);
  background-color: var(--ballot-cream);
  color: var(--ink-blue);
}
```

### Hydration Errors

**avoid-hydration-issues**: Prevent common hydration errors:
```typescript
// Bad - browser API in Server Component
export default function ResultsPage() {
  const timestamp = Date.now() // Different on server vs client
  return <div>{timestamp}</div>
}

// Good - use suppressHydrationWarning for timestamps
export default function ResultsPage() {
  return <div suppressHydrationWarning>{new Date().toISOString()}</div>
}

// Good - Client Component for browser APIs
'use client'
export function RegionSelector() {
  const [region, setRegion] = useState('NCR')
  return <select onChange={(e) => setRegion(e.target.value)}>...</select>
}
```

---

## 11. Technical Decisions Summary

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
