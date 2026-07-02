# PPCRV — Parish Pastoral Council for Responsible Voting

A serverless election monitoring platform for Philippine elections. Volunteers upload precinct CSV data, the system validates and processes it, and the public views aggregated vote results in real time.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Problem Statement](#problem-statement)
- [Proposed Serverless Architecture](#proposed-serverless-architecture)
- [AWS Glue ETL Pipeline](#aws-glue-etl-pipeline)
- [Data Storage Strategy](#data-storage-strategy)
- [Data Accuracy & Integrity](#data-accuracy--integrity)
- [Request Flows](#request-flows)
- [Cost Comparison](#cost-comparison)
- [Open Action Items](#open-action-items)

---

## Project Overview

**PPCRV** (Parish Pastoral Council for Responsible Voting) is a citizen-volunteer election monitoring organization in the Philippines. This application supports the election process by:

1. **Parsing CSV election data** — Volunteers receive CSV files via physical drive and upload them to the cloud
2. **Grouping votes by hierarchy** — Total votes by precinct, candidate, region, and national level
3. **Public results web app** — Citizens view election results in real time
4. **Volunteer validation app** — Volunteers validate CSV integrity using checksums and cross-check QR codes of election returns per precinct

### CSV Input Format

| Column | Description |
|--------|-------------|
| `PRECINCT_CODE` | Unique precinct identifier |
| `CONTEST_CODE` | Election contest (e.g., President, Mayor) |
| `CANDIDATE_CODE` | Candidate identifier |
| `PARTY_CODE` | Party identifier |
| `VOTES_AMOUNT` | Votes received by candidate in precinct |
| `TOTALIZATION_ORDER` | Ordering for totalization |
| `NUMBER_VOTERS` | Number of registered voters in precinct |
| `UNDERVOTE` | Undervote count |
| `OVERVOTE` | Overvote count |
| `RECEPTION_DATE` | Date/time the return was received |

**Scale:** ~32 million rows per election cycle across multiple CSV uploads (up to 2GB per file).

---

## Problem Statement

PPCRV is a **greenfield project** with no existing deployed system. An initial architecture proposal used always-on EC2 instances, but this presents a cost and maintenance problem for an application that is only heavily used during election periods and otherwise idle.

### Initial Proposal (EC2-Based)

The first proposal relied on provisioned EC2 instances for every layer:

| Component | Initial Proposal | Drawback |
|-----------|-----------------|----------|
| Web Application | EC2 (m5.large) | Always running, even when idle |
| Validation Service | EC2 (m5.large, NodeJS) | Always running, even when idle |
| ETL Server | EC2 (c5.xlarge) | Manual batch processing, no auto-scaling |
| Load Balancers | ALB (app + data) | Over-provisioned |
| Static Web Server | EC2 | Unnecessary for static content |
| Relational DB | RDS (db.m5.large) | Always running |
| NoSQL Cache | Aerospike on EC2 (i3.xlarge) | Self-managed, expensive |
| Cache Cluster | i3.large EC2 | Self-managed, expensive |

**Estimated cost:** ~$714/month — paid even when the app is completely idle between elections.

### Why Serverless Instead

The initial proposal's main weakness is paying for idle capacity during the 99% of time the app is not in active use. A serverless approach is a better fit because:

- **Elections are bursty** — traffic spikes during election periods, then drops to near-zero
- **Cost scales with usage** — pay only when requests arrive or jobs run
- **No server maintenance** — no patching, scaling, or OS management
- **Automatic scaling** — handles traffic spikes without capacity planning

---

## Proposed Serverless Architecture

The revised proposal replaces the initial EC2-based design with fully serverless AWS services. The system scales to zero when idle and scales automatically during election traffic spikes.

### Architecture Diagram

```mermaid
graph TB
    %% --- Clients ---
    Public[Public Clients<br/>Access UI + Query Metrics]
    Volunteer[Volunteer Clients<br/>Validate + Upload CSV]

    %% --- Edge Layer ---
    CloudFront[Amazon CloudFront<br/>+ AWS WAF<br/>CDN / Edge Cache / DDoS]
    S3UI[S3 Static UI<br/>Frontend Host]

    Public -->|Access UI| CloudFront
    CloudFront -->|Static HTML| S3UI

    %% --- API Layer ---
    APIGW[Amazon API Gateway<br/>Throttling + Rate Limiting]

    Volunteer -->|Validate API| APIGW
    Public -->|Query Metrics| APIGW

    %% --- Compute: Validation Path ---
    LambdaVal[Lambda Validation<br/>Checksum + QR Cross-check]
    Aurora[Aurora Serverless v2<br/>Validation Records DB]

    APIGW -->|Validation Route| LambdaVal
    LambdaVal -->|Insert records| Aurora

    %% --- Compute: Metrics Path ---
    LambdaMet[Lambda Vote Metrics<br/>Reads aggregated results]
    DDBMetrics[DynamoDB<br/>Aggregated Vote Metrics]

    APIGW -->|Metrics Route| LambdaMet
    LambdaMet -->|Query cache| DDBMetrics

    %% --- ETL Path ---
    S3Upload[S3 CSV Upload Bucket<br/>Volunteer uploads up to 2GB]
    LambdaTrig[Lambda Event Trigger<br/>S3 ObjectCreated event]
    Glue[AWS Glue ETL Job<br/>Parse + Aggregate<br/>Idempotent / Re-runnable]
    S3Parquet[S3 Parquet<br/>Raw Data - Source of Truth<br/>Audit Trail]
    DDBCtrl[DynamoDB Control Table<br/>Precinct Status Tracking]
    SNS[SNS<br/>Failure / Success Alerts]
    SQS[SQS DLQ<br/>Failed Invocations]

    Volunteer -->|Upload CSV| S3Upload
    S3Upload -->|S3 Event| LambdaTrig
    LambdaTrig -->|StartJobRun| Glue
    Glue -->|Write raw data| S3Parquet
    Glue -->|Write metrics| DDBMetrics
    Glue -->|Update status| DDBCtrl
    Glue -->|Failure alert| SNS
    LambdaTrig -.->|Dead letter| SQS

    %% --- Observability ---
    CW[CloudWatch + X-Ray<br/>Alarms / Dashboards / Tracing]
    Glue -.->|Metrics + logs| CW
    LambdaVal -.->|Metrics| CW
    LambdaMet -.->|Metrics| CW

    %% --- Styling ---
    classDef client fill:#e1f5fe,stroke:#0288d1,stroke-width:2px
    classDef edge fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef compute fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef storage fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef etl fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef obs fill:#eceff1,stroke:#546e7a,stroke-width:1px,stroke-dasharray: 5 5

    class Public,Volunteer client
    class CloudFront,S3UI,APIGW edge
    class LambdaVal,LambdaMet,LambdaTrig compute
    class Aurora,DDBMetrics,DDBCtrl,SQS storage
    class S3Upload,S3Parquet,Glue,SNS etl
    class CW obs
```

### Component Breakdown

| Component | Service | Initial Proposal | Purpose |
|-----------|---------|----------|---------|
| CDN + Edge Cache | CloudFront + WAF | ALB + Static EC2 | Serves static UI, DDoS protection, rate limiting |
| Static UI Hosting | S3 | Static Web Server (EC2) | Hosts frontend application |
| API Layer | API Gateway | Application + Data ALBs | Routes requests to Lambda functions |
| Validation Compute | Lambda (Validation) | NodeJS Validation Service (m5.large) | Validates checksums, cross-checks QR codes |
| Metrics Compute | Lambda (Vote Metrics) | Web Application (m5.large) | Queries aggregated results from DynamoDB |
| ETL Compute | AWS Glue | ETL Server (c5.xlarge) | Parses + aggregates CSV data |
| Relational DB | Aurora Serverless v2 | RDS (db.m5.large) | Stores validation records |
| NoSQL Cache | DynamoDB | Aerospike + i3 Cache | Stores aggregated vote metrics |
| Raw Data Storage | S3 (Parquet) | EBS Volumes | Source of truth / audit trail |
| Event Trigger | Lambda (S3 Event) | N/A | Triggers Glue on CSV upload |
| Failure Alerts | SNS | N/A | Notifies on Glue/Lambda failures |
| Dead Letter Queue | SQS DLQ | N/A | Captures failed Lambda invocations |
| Observability | CloudWatch + X-Ray | N/A | Monitoring, alarms, tracing, dashboards |

---

## AWS Glue ETL Pipeline

The ETL pipeline is the core of the data processing flow. AWS Glue replaces the initial proposal's c5.xlarge ETL server with a fully managed, pay-per-use Spark-based processing engine.

### Pipeline Stages

```mermaid
graph TD
    CSV[CSV in S3 Upload Bucket<br/>~32M rows per election]

    %% Stage 1
    S1[Stage 1: INGEST<br/>Read CSV from S3<br/>Parse all rows<br/>Validate schema]
    CSV --> S1

    %% Stage 2
    S2[Stage 2: DEDUPLICATE<br/>Check DynamoDB Control Table<br/>Skip or overwrite<br/>Idempotent — safe to re-run]
    S1 --> S2
    Ctrl[(DynamoDB<br/>Control Table)]
    S2 -->|Check precinct status| Ctrl

    %% Stage 3
    S3[Stage 3: TRANSFORM + AGGREGATE<br/>Group by PRECINCT_CODE<br/>Group by CANDIDATE_CODE<br/>Group by CONTEST_CODE]
    S2 --> S3

    S3A[Compute Totals:<br/>• Votes per candidate per precinct<br/>• Votes per candidate per region<br/>• Votes per candidate national total<br/>• Turnout per precinct<br/>• Undervotes / overvotes per precinct]
    S3 --> S3A

    %% Stage 4
    S4{Stage 4: PERSIST}
    S3A --> S4

    S3Parquet[(S3 Parquet<br/>Raw Data — Source of Truth)]
    DDBMet[(DynamoDB<br/>Aggregated Metrics)]
    CtrlUpd[(DynamoDB<br/>Control Table)]

    S4 -->|Write raw data| S3Parquet
    S4 -->|Write aggregated metrics| DDBMet
    S4 -->|Update precinct status| CtrlUpd

    %% Stage 5
    S5[Stage 5: RECONCILIATION CHECK<br/>Compare sum raw S3 vs sum DynamoDB]
    S3Parquet --> S5
    DDBMet --> S5
    SNSAlert((SNS Alert<br/>+ Auto re-run Glue))

    S5 -->|Match| OK[Data Consistent ✓]
    S5 -->|Mismatch| SNSAlert

    %% Trigger
    Trigger[Lambda Event Trigger<br/>S3 ObjectCreated event]
    Trigger -->|StartJobRun| CSV

    %% Styling
    classDef stage fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef compute fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef storage fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef decision fill:#fff9c4,stroke:#f9a825,stroke-width:2px
    classDef alert fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef ok fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    class S1,S2,S3,S3A stage
    class Trigger,CSV compute
    class Ctrl,S3Parquet,DDBMet,CtrlUpd storage
    class S4,S5 decision
    class SNSAlert alert
    class OK ok
```

### Why Glue Over Lambda for ETL?

| Factor | AWS Glue | Lambda |
|--------|---------|--------|
| Max execution time | Unlimited (managed Spark) | 15 minutes |
| Memory | Scales across cluster | 10GB max |
| 32M row processing | Native (Spark distributed) | Would require chunking/fan-out |
| Cost model | Per-DPU-second (pay for actual processing) | Per-request + duration |
| Best for | Large batch ETL | Small event-driven tasks |

Glue handles the 32M row batch natively. Lambda is kept for lightweight triggers (S3 event) and API routes (validation, metrics query).

### Glue Job Configuration (Recommended)

| Setting | Value | Rationale |
|---------|-------|-----------|
| Worker type | G.1X (1 DPU, 8GB) | Good balance of cost/performance |
| Worker count | 5-10 | Parallel processing for 32M rows |
| Glue version | 4.0 | Latest, supports Python/PySpark |
| Job bookmark | Enabled | Tracks processed files, supports incremental loads |
| Max retries | 3 | Auto-retry on transient failures |
| Timeout | 60 minutes | Safety limit |
| Notifications | SNS on FAIL/SUCCESS | Visibility into job status |

---

## Data Storage Strategy

The system uses a **dual-store** approach: raw data in S3 for auditability, aggregated metrics in DynamoDB for fast public reads.

### S3 (Parquet) — Source of Truth

| Aspect | Detail |
|--------|--------|
| Purpose | Store raw, unmodified CSV data converted to Parquet |
| Format | Parquet (columnar, compressed, queryable via Athena) |
| Partitioning | `year/election_id/precinct_code/` |
| Use cases | Audit trails, ad-hoc analysis, re-aggregation if needed |
| Retention | Permanent (election records must be preserved) |
| Queryable via | AWS Athena (SQL on S3, serverless, pay-per-query) |

### DynamoDB — Aggregated Metrics

| Table | Partition Key | Sort Key | Purpose |
|-------|--------------|----------|---------|
| `VoteMetrics` | `contest_code#candidate_code` | `granularity#region_code` | Aggregated vote totals (national, regional, precinct) |
| `PrecinctStatus` | `precinct_code` | — | Tracks which precincts have been processed |
| `ElectionMetadata` | `election_id` | — | Election-level status (total precincts, reported count) |

**Why aggregated, not raw?**

| | Raw (32M items) | Aggregated (~thousands) |
|---|---|---|
| DynamoDB write cost | Very high | Low |
| Query latency | Slow (scan + sum) | Fast (single-item lookup) |
| Storage | Large | Small |
| Public UX | Must compute on-the-fly | Results ready instantly |

### Aurora Serverless v2 — Validation Records

| Aspect | Detail |
|--------|--------|
| Purpose | Stores volunteer validation records (checksum, QR cross-check results) |
| Why Aurora | Relational schema, complex queries on validation history |
| Why Serverless v2 | Scales to 0.5 ACU when idle, no full cold start (unlike v1) |
| Min capacity | 0.5 ACU |
| Max capacity | 16 ACU (auto-scales) |

---

## Data Accuracy & Integrity

For an election monitoring system, accuracy is non-negotiable. The following measures ensure data integrity end-to-end:

### 1. Checksum Validation (Pre-ETL Gate)

```mermaid
graph TD
    Upload[Volunteer uploads CSV]
    Lambda[Lambda Validation<br/>Verify file checksum<br/>Cross-check QR code data]
    Decision{Data valid?}
    Reject[REJECTED<br/>Data never enters ETL pipeline]
    Aurora[(Aurora Serverless v2<br/>Validation record logged)]
    Proceed[GOOD DATA<br/>Proceeds to S3 + Glue]

    Upload --> Lambda
    Lambda --> Decision
    Decision -->|BAD DATA| Reject
    Decision -->|GOOD DATA| Aurora
    Aurora --> Proceed

    classDef reject fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef accept fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef decision fill:#fff9c4,stroke:#f9a825,stroke-width:2px

    class Reject reject
    class Proceed accept
    class Decision decision
```

### 2. Idempotent Glue Job

- Glue checks the `PrecinctStatus` DynamoDB table before processing
- If a precinct was already processed, Glue **overwrites** (not adds) — preventing double-counting
- Safe to re-run the same CSV upload without inflating totals

### 3. Atomic Batch Updates

- Glue writes to a **S3 staging area** first
- Only after all aggregation is complete, a single batch update writes to DynamoDB
- A `data_status` field tracks "partial" vs "complete" state

### 4. Reconciliation Job

- Periodic check: `sum(raw votes in S3 Parquet) == sum(aggregated totals in DynamoDB)`
- Mismatch triggers an **SNS alert** and automatic Glue re-run
- Uses Athena to query S3 Parquet in seconds

### 5. Public Transparency

- Frontend displays "X of Y precincts reported" using `ElectionMetadata` table
- Results shown as "processing" until all expected precincts are in
- Citizens see data status, not just numbers

### 6. Audit Trail

- Raw CSV data preserved in S3 (Parquet) permanently
- Any disputed result can be re-verified via Athena queries on raw data
- Glue job is re-runnable from S3 at any time — DynamoDB aggregates can be rebuilt from scratch

---

## Request Flows

The following UML sequence diagrams detail the end-to-end request flows for each use case. Diagrams use [Mermaid](https://mermaid.js.org/) syntax and render natively on GitHub, GitLab, and most markdown viewers.

### Flow 1 — Load Website (Public)

Citizens access the public election results website. CloudFront serves cached static assets from the S3 origin.

```mermaid
sequenceDiagram
    participant Public as Public Client
    participant CDN as CloudFront + WAF
    participant S3 as S3 Static UI

    Public->>CDN: GET / (request website)
    CDN->>CDN: WAF checks request (rate limit, DDoS)
    alt Cache hit at edge
        CDN-->>Public: Return cached HTML/JS (fast)
    else Cache miss
        CDN->>S3: Fetch static assets (origin)
        S3-->>CDN: Return HTML/JS files
        CDN-->>Public: Return HTML/JS (cached at edge)
    end
```

### Flow 2 — Validate Vote (Volunteer)

Volunteers validate the integrity of uploaded CSV data using checksums and QR code cross-checks before the data enters the ETL pipeline.

```mermaid
sequenceDiagram
    participant Vol as Volunteer Client
    participant GW as API Gateway
    participant Lambda as Lambda Validation
    participant Aurora as Aurora Serverless v2

    Vol->>GW: POST /validate (CSV metadata + checksum)
    GW->>GW: Throttle + rate limit check
    GW->>Lambda: Invoke validation
    Lambda->>Lambda: Verify file checksum
    Lambda->>Lambda: Cross-check QR code data
    alt Invalid data
        Lambda-->>GW: 400 — Validation failed (checksum mismatch)
        GW-->>Vol: 400 — Rejected (data never enters pipeline)
    else Valid data
        Lambda->>Aurora: INSERT validation record
        Aurora-->>Lambda: Confirm insert
        Lambda-->>GW: 200 — Validation passed
        GW-->>Vol: 200 — Proceed to upload
    end
```

### Flow 3 — Query Vote Metrics (Public)

Citizens query aggregated election results. Data is pre-computed and stored in DynamoDB for fast reads.

```mermaid
sequenceDiagram
    participant Public as Public Client
    participant GW as API Gateway
    participant Lambda as Lambda Vote Metrics
    participant DDB as DynamoDB (Metrics)

    Public->>GW: GET /results?contest=...&region=...
    GW->>GW: Throttle + rate limit check
    GW->>Lambda: Invoke metrics query
    Lambda->>DDB: Query aggregated results (pre-computed)
    DDB-->>Lambda: Return metrics (single-item lookup)
    Lambda->>Lambda: Format response + data_status
    Lambda-->>GW: 200 — Aggregated results + precincts reported count
    GW-->>Public: 200 — Results (fast, cached)
```

### Flow 4 — Upload Precinct CSV (Volunteer)

Volunteers upload large CSV files (up to 2GB). The upload triggers an event-driven ETL pipeline that parses, deduplicates, aggregates, and persists the data.

```mermaid
sequenceDiagram
    participant Vol as Volunteer Client
    participant S3U as S3 Upload Bucket
    participant Trig as Lambda Event Trigger
    participant Glue as AWS Glue ETL Job
    participant S3P as S3 (Parquet)
    participant DDB as DynamoDB (Metrics)
    participant Ctrl as DynamoDB (Control)
    participant SNS as SNS

    Vol->>S3U: Upload CSV (presigned URL, up to 2GB)
    S3U-->>Vol: 200 — Upload complete
    S3U->>Trig: S3 Event Notification (ObjectCreated)
    Trig->>Glue: StartJobRun (CSV path)
    
    Note over Glue: Stage 1 — INGEST
    Glue->>S3U: Read CSV (~millions of rows)
    S3U-->>Glue: Return CSV data
    
    Note over Glue: Stage 2 — DEDUPLICATE
    Glue->>Ctrl: Check PrecinctStatus (already processed?)
    Ctrl-->>Glue: Return status
    
    Note over Glue: Stage 3 — TRANSFORM + AGGREGATE
    Glue->>Glue: Group by precinct / candidate / contest
    Glue->>Glue: Compute totals (national, regional, precinct)
    
    Note over Glue: Stage 4 — PERSIST
    Glue->>S3P: Write raw data (Parquet, partitioned)
    S3P-->>Glue: Confirm write
    Glue->>DDB: Batch write aggregated metrics
    DDB-->>Glue: Confirm write
    Glue->>Ctrl: Update PrecinctStatus (processed)
    Ctrl-->>Glue: Confirm update
    
    alt Job succeeds
        Glue->>SNS: Publish SUCCESS notification
        SNS-->>Vol: Email/notification — Processing complete
    else Job fails
        Glue->>SNS: Publish FAILURE notification
        SNS-->>Vol: Email/notification — Processing failed (will retry)
    end
```

### Flow 5 — Reconciliation (Automated)

A periodic automated job verifies data integrity by comparing raw source data against aggregated totals.

```mermaid
sequenceDiagram
    participant CW as CloudWatch (Scheduled)
    participant Athena as Amazon Athena
    participant S3P as S3 (Parquet)
    participant DDB as DynamoDB (Metrics)
    participant SNS as SNS

    CW->>Athena: Trigger reconciliation query
    Athena->>S3P: SELECT SUM(votes) GROUP BY candidate
    S3P-->>Athena: Return raw totals
    Athena->>DDB: Query aggregated totals
    DDB-->>Athena: Return aggregated totals
    Athena->>Athena: Compare raw sum vs aggregated sum
    alt Totals match
        Athena-->>CW: OK — Data consistent
    else Mismatch detected
        Athena->>SNS: Publish MISMATCH alert
        SNS->>SNS: Trigger Glue re-run (auto-remediation)
        Note over SNS: Engineering team notified
    end
```

---

## Cost Comparison

| Component | Initial Proposal (EC2) | Est. Cost/mo | Serverless Proposal | Idle/mo | Peak/mo |
|-----------|------------------------|-------------|---------------------|---------|---------|
| Web Application | EC2 (m5.large) | $70 | Lambda + API Gateway | $0 | $30 |
| NoSQL Database | Aerospike (i3.xlarge) | $227 | DynamoDB | $0 | $50 |
| Relational DB | RDS (db.m5.large) | $130 | Aurora Serverless v2 | $0 | $40 |
| File Processing | EC2 (c5.xlarge) | $124 | AWS Glue | $0 | $20 |
| Caching | i3.large EC2 | $113 | DynamoDB (consolidated) | $0 | $15 |
| Static UI + CDN | N/A | $0 | S3 + CloudFront | $5 | $50 |
| Raw Data Storage | EBS Volumes | $50 | S3 (Parquet) | $10 | $15 |
| **Total** | | **$714** | | **$15** | **$220** |

**Savings:** ~70% at peak, ~98% when idle. The serverless proposal costs almost nothing between election cycles.

---

## Open Action Items

Items from the architecture draft that require further investigation:

| # | Item | Status |
|---|------|--------|
| 1 | Verify Aurora Serverless max storage capacity for validation records | TODO |
| 2 | Benchmark AppSync vs API Gateway for processing time | TODO |
| 3 | API Gateway 29-second timeout — identify any long-running operations | TODO |
| 4 | Evaluate AI/ML models for anomaly detection in vote data | TODO |
| 5 | Estimate AI model costs if anomaly detection is added | TODO |
| 6 | Finalize AWS Glue job design (worker count, partitioning strategy) | TODO |
| 7 | Configure rate limiting + WAF rules for public-facing endpoints | TODO |
| 8 | Define DynamoDB schema for aggregated metrics (partition/sort keys) | TODO |
| 9 | Build reconciliation job + SNS alerting | TODO |
| 10 | Set up CloudWatch dashboards for election-day monitoring | TODO |

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | Static HTML/JS (React or similar) hosted on S3 + CloudFront |
| API | Amazon API Gateway (REST) |
| Validation Compute | AWS Lambda (Node.js or Python) |
| Metrics Compute | AWS Lambda (Node.js or Python) |
| ETL | AWS Glue (PySpark) |
| Relational DB | Amazon Aurora Serverless v2 (PostgreSQL) |
| NoSQL DB | Amazon DynamoDB |
| Object Storage | Amazon S3 (Parquet for raw, HTML for UI) |
| CDN / Security | CloudFront + AWS WAF |
| Notifications | Amazon SNS |
| Queue / DLQ | Amazon SQS |
| Observability | CloudWatch + X-Ray |
| Ad-hoc Queries | Amazon Athena (SQL on S3 Parquet) |
| IaC | AWS CDK / SAM / Terraform (TBD) |
