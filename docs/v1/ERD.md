# Database ERD — PPRCV-POC

This project uses **two database engines** for different purposes:

| Engine | Role | Persistence |
|--------|------|-------------|
| **PostgreSQL** | Reference data warehouse | Persistent (tables survive) |
| **DuckDB** | Analytics ETL + API query engine | Ephemeral (in-memory tables during ETL; results written to Parquet) |

---

## 1. PostgreSQL Schema — Reference Data

Four tables storing political reference data (parties, contests, precincts, candidates). These are the **source of truth** for entity names and hierarchies.

### Entity Relationship Diagram

```mermaid
erDiagram
    ref_parties {
        TEXT parties_code PK "e.g. 'LP', 'NP'"
        TEXT parties_name "Full party name"
        TEXT parties_alias "Optional alias"
    }

    ref_contests {
        TEXT contest_code PK "e.g. 'PRESIDENT', 'MAYOR-123'"
        TEXT contest_name "Full contest name"
    }

    ref_precincts {
        TEXT acm_id PK "Unique precinct ID (ACM)"
        TEXT reg_name "Region name"
        TEXT prv_name "Province name"
        TEXT mun_name "Municipality name"
        TEXT brgy_name "Barangay name"
        TEXT pollplace "Polling place / voting center"
        TEXT clustered_prec "Clustered precinct code"
        INTEGER registered_voters "Registered voter count"
    }

    ref_candidates {
        TEXT contest_code PK, FK "References ref_contests"
        TEXT candidate_code PK "Candidate ID within contest"
        TEXT candidate_name "Full candidate name"
        TEXT parties_code FK "References ref_parties"
    }

    ref_contests ||--o{ ref_candidates : "has"
    ref_parties ||--o{ ref_candidates : "nominates"
```

### Table Details

| Table | Rows | Source CSV | Load Script |
|-------|------|------------|-------------|
| `ref_parties` | ~339 | `sample-csv/parties.csv` | `apps/etl/scripts/load_ref_data.py` |
| `ref_contests` | ~5,645 | `sample-csv/contest.csv` | `apps/etl/scripts/load_ref_data.py` |
| `ref_precincts` | ~93,629 | `sample-csv/precincts.csv` | `apps/etl/scripts/load_ref_data.py` |
| `ref_candidates` | ~41,647 | `sample-csv/candidates.csv` | `apps/etl/scripts/load_ref_data.py` |

### Relationships

- **`ref_candidates.contest_code` → `ref_contests.contest_code`**: Each candidate belongs to exactly one contest. A contest has many candidates.
- **`ref_candidates.parties_code` → `ref_parties.parties_code`**: Each candidate is nominated by one party (nullable for independent/party-list candidates). A party can nominate many candidates.

---

## 2. DuckDB ETL Pipeline — Analytics Processing

DuckDB is used in two phases:

1. **ETL phase** — Python `duckdb` library creates in-memory tables, joins, aggregates, and writes Parquet files
2. **API phase** — NestJS shells out to `duckdb` CLI to query Parquet files on-read

### 2A. Simple Aggregation (`apps/etl/src/etl/processor.py`)

```mermaid
erDiagram
    raw_data {
        varchar precinct_code
        varchar contest_code
        varchar candidate_name
        varchar party_code
        int votes_amount
        int over_votes
        int under_votes
        int totalization_order
        int number_voters
        date reception_date
    }

    agg_data {
        varchar precinct_code PK
        varchar contest_code PK
        varchar candidate_name
        varchar party_code
        bigint total_votes
        bigint total_over_votes
        bigint total_under_votes
    }

    parquet_single_level {
        varchar precinct_code
        varchar contest_code "Partition key"
        varchar candidate_name
        varchar party_code
        bigint total_votes
        bigint total_over_votes
        bigint total_under_votes
    }

    raw_data ||--o| agg_data : "GROUP BY precinct, contest, candidate, party"
    agg_data ||--o| parquet_single_level : "COPY TO Parquet (partitioned by contest_code)"
```

### 2B. Multi-Level Aggregation (`apps/etl/src/etl/aggregator.py`)

This is the **primary pipeline**. It joins raw results with precinct reference data, then produces 6 hierarchical aggregation levels.

```mermaid
erDiagram
    raw_results {
        varchar precinct_code
        varchar contest_code
        varchar candidate_name
        varchar party_code
        int votes_amount
        int over_votes
        int under_votes
        int totalization_order
        int number_voters
        date reception_date
    }

    ref_precincts_duckdb {
        varchar ACM_ID
        varchar REG_NAME
        varchar PRV_NAME
        varchar MUN_NAME
        varchar BRGY_NAME
        varchar POLLPLACE
        varchar CLUSTERED_PREC
        int REGISTERED_VOTERS
    }

    joined_data {
        varchar contest_code
        varchar candidate_name
        varchar party_code
        int votes_amount
        int over_votes
        int under_votes
        varchar reg_name
        varchar prv_name
        varchar mun_name
        varchar brgy_name
        varchar pollplace
    }

    agg_national {
        varchar contest_code PK
        varchar candidate_name PK
        varchar party_code
        bigint total_votes
        bigint total_over_votes
        bigint total_under_votes
    }

    agg_region {
        varchar contest_code PK
        varchar reg_name PK
        varchar candidate_name PK
        varchar party_code
        bigint total_votes
        bigint total_over_votes
        bigint total_under_votes
    }

    agg_province {
        varchar contest_code PK
        varchar reg_name PK
        varchar prv_name PK
        varchar candidate_name PK
        varchar party_code
        bigint total_votes
        bigint total_over_votes
        bigint total_under_votes
    }

    agg_municipality {
        varchar contest_code PK
        varchar reg_name PK
        varchar prv_name PK
        varchar mun_name PK
        varchar candidate_name PK
        varchar party_code
        bigint total_votes
        bigint total_over_votes
        bigint total_under_votes
    }

    agg_barangay {
        varchar contest_code PK
        varchar reg_name PK
        varchar prv_name PK
        varchar mun_name PK
        varchar brgy_name PK
        varchar candidate_name PK
        varchar party_code
        bigint total_votes
        bigint total_over_votes
        bigint total_under_votes
    }

    agg_precinct {
        varchar contest_code PK
        varchar reg_name PK
        varchar prv_name PK
        varchar mun_name PK
        varchar brgy_name PK
        varchar pollplace PK
        varchar candidate_name PK
        varchar party_code
        bigint total_votes
        bigint total_over_votes
        bigint total_under_votes
    }

    %% Relationships
    raw_results ||--o{ joined_data : "LEFT JOIN ref_precincts ON clustered_prec"
    ref_precincts_duckdb ||--o{ joined_data : "LEFT JOIN"

    joined_data ||--o| agg_national : "GROUP BY contest, candidate, party"
    joined_data ||--o| agg_region : "GROUP BY + reg_name"
    joined_data ||--o| agg_province : "GROUP BY + reg_name, prv_name"
    joined_data ||--o| agg_municipality : "GROUP BY + reg_name, prv_name, mun_name"
    joined_data ||--o| agg_barangay : "GROUP BY + all geo except pollplace"
    joined_data ||--o| agg_precinct : "GROUP BY + all geo including pollplace"
```

### 2C. Parquet Output Structure

All 6 aggregation levels are written as **Hive-partitioned Parquet** files:

```
apps/etl/output/multi-level/
├── national/           # contest_code=XXX/*.parquet
├── region/             # contest_code=XXX/*.parquet
├── province/           # contest_code=XXX/*.parquet
├── municipality/       # contest_code=XXX/*.parquet
├── barangay/           # contest_code=XXX/*.parquet
└── precinct/           # contest_code=XXX/*.parquet
```

Each Parquet file contains all columns for that level (see above). Partitioned by `contest_code` for efficient predicate pushdown.

---

## 3. API Query Layer — DuckDB CLI on Parquet

The NestJS API (`results.service.ts`) queries Parquet files by glob pattern:

```mermaid
flowchart LR
    A[Client Request] --> B[NestJS API]
    B --> C[duckdb CLI]
    C --> D["'{parquetBase}/{level}/**/*.parquet'"]
    D --> C
    C --> B
    B --> E[JSON Response]

    subgraph Queries
        F[SELECT candidate_name, party_code,\nSUM(total_votes) as votes\nFROM glob\nWHERE filters\nGROUP BY candidate, party\nORDER BY votes DESC]
        G[SELECT DISTINCT column\nFROM glob\nWHERE parent_filter\nORDER BY column]
    end
```

### Query Patterns

| Query | File | Purpose |
|-------|------|---------|
| Results | `results.service.ts:78-103` | Aggregated votes by candidate with filters |
| Distinct values | `results.service.ts:65-76` | Cascading dropdown values for geography |
| Contest listing | `results.service.ts:58-63` | All distinct contest codes from national level |

---

## 4. End-to-End Data Flow

```mermaid
flowchart TD
    subgraph Sources["Source CSVs"]
        R[results.csv<br/>24M rows]
        P[precincts.csv<br/>93K rows]
        PT[parties.csv<br/>339 rows]
        CT[contest.csv<br/>5.6K rows]
        CD[candidates.csv<br/>41K rows]
    end

    subgraph Postgres["PostgreSQL (Reference Data)"]
        RP[ref_parties]
        RC[ref_contests]
        RPC[ref_precincts]
        RCD[ref_candidates]
    end

    subgraph DuckDB_ETL["DuckDB ETL (ephemeral)"]
        RR[raw_results]
        RP_DB[ref_precincts]
        JD[joined_data]
        A1[agg_national]
        A2[agg_region]
        A3[agg_province]
        A4[agg_municipality]
        A5[agg_barangay]
        A6[agg_precinct]
    end

    subgraph Parquet["Parquet Files (persistent)"]
        PN[national/]
        PR[region/]
        PP[province/]
        PM[municipality/]
        PB[barangay/]
        PPR[precinct/]
    end

    subgraph API["NestJS API"]
        Q[duckdb CLI queries]
    end

    R --> RR
    P --> RP_DB
    PT --> RP
    CT --> RC
    CD --> RCD

    RR --> JD
    RP_DB --> JD
    JD --> A1 & A2 & A3 & A4 & A5 & A6
    
    A1 --> PN
    A2 --> PR
    A3 --> PP
    A4 --> PM
    A5 --> PB
    A6 --> PPR

    PN & PR & PP & PM & PB & PPR --> Q
```

---

## 5. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **DuckDB over Postgres for analytics** | DuckDB is optimized for OLAP/aggregation workloads. Postgres is used only for reference data lookups. |
| **Parquet as interchange format** | Columnar format enables efficient predicate pushdown, compression, and schema evolution. DuckDB can query Parquet files directly (zero-copy). |
| **Hive partitioning by `contest_code`** | Most queries filter by contest. Partition pruning eliminates scanning irrelevant files. |
| **6 pre-computed aggregation levels** | Avoids expensive GROUP BY at query time. Each level is a trade-off between storage and query speed. |
| **No ORM** | Direct SQL gives full control over DuckDB-specific features (Parquet glob queries, Hive partitioning). |
| **CLI subprocess (not DuckDB node lib)** | Avoids native module compilation issues. DuckDB CLI is a single binary with no dependencies. |
