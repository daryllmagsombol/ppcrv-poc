# PPCRV Re-Architecture — Cloud-Portable Architecture (Delta)

This document describes the **changes** from the original serverless architecture (see [README.md](README.md)) to a cloud-portable design using **AWS Fargate containers**. The goal: build on AWS now, but choose services that have equivalents on GCP and Azure so switching later is feasible with minimal changes.

> [!NOTE]
> This is a **delta document** — it only describes what changes from the original architecture. Reader cross-references [README.md](README.md) and [docs/COSTS.md](docs/COSTS.md) for unchanged services and full context.
>
> Cost impact for this architecture is documented in [cost-re-arch.md](cost-re-arch.md).

---

## Table of Contents

- [Why Re-Architecture?](#why-re-architecture)
- [Architecture Delta](#architecture-delta)
- [Service Migration Map](#service-migration-map)
- [Abstraction Patterns for Portability](#abstraction-patterns-for-portability)
- [Request Flows (Changed)](#request-flows-changed)
- [Portability Reference](#portability-reference)
- [Migration Path to GCP or Azure](#migration-path-to-gcp-or-azure)

---

## Why Re-Architecture?

The original architecture uses AWS-native serverless services (Lambda, Glue, API Gateway). These are excellent for the workflow but **AWS-locked**:

- **Lambda** functions only run on AWS
- **Glue** jobs use AWS-managed Spark clusters with no equivalent API elsewhere
- **API Gateway** has its own request/response model and AWS-specific integrations

The **Re-Architecture** replaces these with **Fargate containers**:

- The same Docker image runs on **AWS Fargate**, **GCP Cloud Run**, and **Azure Container Apps**
- Compute logic lives in the container, not in a cloud function — ports with a config change
- The ETL logic (Python + DuckDB/pandas) runs in a container instead of a Spark cluster

**Trade-off accepted:** Fargate containers have slower cold starts than Lambda (~10-30s vs ~100-500ms) and the ALB costs ~$18/mo even when idle. This is the **cost of portability**.

---

## Architecture Delta

### New Architecture (v2 — Re-Architecture)

```mermaid
graph TB
    classDef new fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef removed fill:#ffebee,stroke:#c62828,stroke-width:1px,stroke-dasharray: 5 5
    classDef unchanged fill:#e3f2fd,stroke:#1976d2,stroke-width:1px

    Public[Public Clients]
    Volunteer[Volunteer Clients]

    CF[CloudFront + WAF]:::unchanged
    ALB["Application Load Balancer<br/><b>NEW — replaces API Gateway</b>"]:::new

    subgraph Fargate["Fargate — One Container Image"]
        API["API Container<br/>FastAPI / Express<br/>Routes: /metrics, /validate<br/><b>Replaces Lambda ×2</b>"]:::new
        ETL["ETL Container<br/>Python + DuckDB/pandas<br/>Triggered on S3 upload<br/><b>Replaces Glue</b>"]:::new
    end

    S3Upload[S3 Upload Bucket]:::unchanged
    S3Trigger["Lambda Trigger<br/>(tiny — just schedules ETL task)"]:::unchanged
    SF["Step Functions<br/>Orchestrates ETL fan-out"]:::new
    S3Parquet[S3 Parquet]:::unchanged
    Aurora[Aurora Serverless v2<br/>Postgres connection]:::unchanged
    DDB[DynamoDB<br/>via Repository interface]:::unchanged
    SNS[SNS]:::unchanged
    SQS[SQS DLQ]:::unchanged

    Public --> CF
    Volunteer --> CF
    CF --> ALB
    ALB --> API
    API --> Aurora
    API --> DDB

    Volunteer -->|Upload CSV| S3Upload
    S3Upload -->|S3 Event| S3Trigger
    S3Trigger -->|Start Task| SF
    SF -->|Run 1-N parallel| ETL
    ETL -->|Write Parquet| S3Parquet
    ETL -->|Write metrics| DDB
    ETL -->|Failure| SNS
```

### What's Removed

| Removed | Why |
|---------|-----|
| API Gateway (HTTP API) | ALB in front of Fargate handles routing + throttling |
| Lambda Vote Metrics | Fargate API container serves the same routes |
| Lambda Validation | Same Fargate API container — different route |
| AWS Glue (Spark) | Fargate ETL container with Python + DuckDB/pandas |

### What's Added

| Added | Purpose |
|-------|---------|
| **Fargate API** | Long-running container serving HTTP requests via ALB |
| **Fargate ETL** | On-demand container for CSV processing, triggered by Step Functions |
| **ALB** | Routes HTTP traffic to Fargate, health checks, autoscaling trigger |
| **Step Functions** | Orchestrates parallel ETL task fan-out (one task per CSV file) |
| **ECR** | Container registry for Docker images |

### What's Unchanged

| Kept | Portability Strategy |
|------|----------------------|
| Aurora Serverless v2 | Accessed via standard Postgres connection (no Aurora APIs) |
| DynamoDB | Wrapped in Repository interface (swap impl when moving clouds) |
| S3 | Storage abstraction (swap impl to GCS / Blob later) |
| SNS + SQS | Messaging abstraction (swap impl to Pub/Sub / Service Bus later) |
| CloudFront + WAF | Edge layer — swap to Cloud CDN / Azure CDN later |
| Route 53 | DNS — swap to Cloud DNS / Azure DNS later |
| CloudWatch + X-Ray | Observability — swap to Cloud Logging / Azure Monitor later |
| Athena | Ad-hoc analytics — swap to BigQuery / Azure Synapse later |

---

## Service Migration Map

| Layer | AWS (now) | GCP (later) | Azure (later) | Migration Effort |
|-------|-----------|-------------|---------------|-----------------|
| Compute (API) | **Fargate** | Cloud Run | Container Apps | **None** — same Docker image |
| Compute (ETL) | **Fargate + Step Functions** | Cloud Run Jobs + Workflows | Container Apps Jobs | **Minimal** — image stays, orchestrator rewritten |
| API Routing | ALB | Cloud Load Balancing | Application Gateway | **Low** — Terraform resource swap |
| Relational DB | Aurora Serverless v2 | Cloud SQL (Postgres) | Azure Database (Postgres) | **Low** — data dump + restore, connection string change |
| NoSQL | DynamoDB | Firestore | Cosmos DB | **Medium** — repository impl swap + data migration (~4 days) |
| Object Storage | S3 | GCS | Blob Storage | **Low** — storage client impl swap |
| Messaging | SNS + SQS | Pub/Sub | Service Bus | **Low** — queue impl swap |
| Edge / CDN | CloudFront + WAF | Cloud CDN + Armor | Azure CDN + WAF | **Medium** — config rewrite |
| DNS | Route 53 | Cloud DNS | Azure DNS | **Low** — zone export/import |
| Observability | CloudWatch + X-Ray | Cloud Logging + Trace | Azure Monitor | **Medium** — instrumentation swap |
| IaC | Terraform | Same (add GCP provider) | Same (add Azure provider) | **Low** — HCL modules already portable |

---

## Abstraction Patterns for Portability

The Fargate containers don't call AWS SDKs directly. Every cloud-specific service sits behind an interface so swapping clouds means writing a new implementation, not touching the container code.

```mermaid
graph TB
    classDef container fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef interface fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef aws fill:#e3f2fd,stroke:#1976d2,stroke-width:1px
    classDef gcp fill:#fce4ec,stroke:#c62828,stroke-width:1px,stroke-dasharray: 5 5
    classDef azure fill:#ede7f6,stroke:#5e35b1,stroke-width:1px,stroke-dasharray: 5 5

    subgraph Container["Fargate Container (cloud-agnostic)"]
        App[Application Code]:::container
    end

    subgraph Interfaces["Interface Layer (interfaces only, no SDK calls)"]
        MetricsRepo["MetricsRepository<br/>getMetrics() / putMetrics()"]:::interface
        ValidationRepo["ValidationRepository<br/>saveRecord() / getRecord()"]:::interface
        Storage["StorageClient<br/>upload() / download() / list()"]:::interface
        Queue["MessageQueue<br/>publish() / subscribe()"]:::interface
    end

    App --> MetricsRepo
    App --> ValidationRepo
    App --> Storage
    App --> Queue

    subgraph AWS["AWS Implementations (today)"]
        DDBImpl["DynamoDBMetricsRepository"]:::aws
        PgImpl["PostgresValidationRepository<br/>(Aurora)"]:::aws
        S3Impl["S3StorageClient"]:::aws
        SNSImpl["SNSMessageQueue"]:::aws
    end

    subgraph GCP["GCP Implementations (future)"]
        FSImpl["FirestoreMetricsRepository"]:::gcp
        PgGCP["PostgresValidationRepository<br/>(Cloud SQL)"]:::gcp
        GCSImpl["GCSStorageClient"]:::gcp
        PSImpl["PubSubMessageQueue"]:::gcp
    end

    subgraph Azure["Azure Implementations (future)"]
        CosImpl["CosmosMetricsRepository"]:::azure
        PgAz["PostgresValidationRepository<br/>(Azure Postgres)"]:::azure
        BlobImpl["BlobStorageClient"]:::azure
        SBImpl["ServiceBusMessageQueue"]:::azure
    end

    MetricsRepo -.-> DDBImpl
    MetricsRepo -.-> FSImpl
    MetricsRepo -.-> CosImpl
    ValidationRepo -.-> PgImpl
    ValidationRepo -.-> PgGCP
    ValidationRepo -.-> PgAz
    Storage -.-> S3Impl
    Storage -.-> GCSImpl
    Storage -.-> BlobImpl
    Queue -.-> SNSImpl
    Queue -.-> PSImpl
    Queue -.-> SBImpl
```

### Four Interfaces to Implement

| Interface | Methods | AWS Impl (now) | GCP Impl (later) | Azure Impl (later) |
|-----------|---------|----------------|------------------|---------------------|
| `MetricsRepository` | `getMetrics(pk)`, `putMetrics(pk, data)` | DynamoDB | Firestore | Cosmos DB |
| `ValidationRepository` | `saveRecord()`, `getRecord()` | Aurora (Postgres) | Cloud SQL (Postgres) | Azure Database (Postgres) |
| `StorageClient` | `upload()`, `download()`, `list()` | S3 | GCS | Blob Storage |
| `MessageQueue` | `publish()`, `subscribe()` | SNS + SQS | Pub/Sub | Service Bus |

### Rules for the Team

1. **Never import `boto3` / AWS SDK inside the container app code.** All AWS calls live inside the `*Impl` classes only.
2. **Each interface has one implementation per cloud.** Swapping clouds = writing new impls + a config flag that selects which.
3. **Postgres stays vanilla.** No Aurora Data API, no RDS-specific extensions — just standard SQL via a Postgres driver (`pg`, `psycopg2`).
4. **DynamoDB access is via the Repository only.** No `GetItemCommand` outside `DynamoDBMetricsRepository`.

### Configuration Selection

```python
# config.py — one env var flips the whole backend
import os

CLOUD = os.environ.get('CLOUD_PROVIDER', 'aws')

if CLOUD == 'aws':
    from .aws import DynamoDBMetricsRepository, S3StorageClient
    metrics_repo = DynamoDBMetricsRepository()
    storage = S3StorageClient()
elif CLOUD == 'gcp':
    from .gcp import FirestoreMetricsRepository, GCSStorageClient
    metrics_repo = FirestoreMetricsRepository()
    storage = GCSStorageClient()
```

Docker image stays identical — only the runtime config changes.

---

## Request Flows (Changed)

### Flow 1: Public Query → Metrics (Changed)

```mermaid
sequenceDiagram
    participant Public as Public Browser
    participant CF as CloudFront + WAF
    participant ALB as ALB
    participant API as Fargate API Container
    participant Repo as MetricsRepository
    participant DDB as DynamoDB

    Public->>CF: GET /metrics?precinct=123
    CF->>CF: WAF inspect + rate limit
    CF->>ALB: Route to Fargate
    ALB->>API: Forward request
    API->>API: Cache check (in-memory)
    alt Cache miss
        API->>Repo: getMetrics("precinct#123")
        Repo->>DDB: GetItem (hidden behind interface)
        DDB-->>Repo: Vote data
        Repo-->>API: VoteMetrics object
    else Cache hit
        API->>API: Return cached result
    end
    API->>CF: JSON response
    CF->>Public: Cached response (TTL 30s)
```

**Delta from v1:** Lambda → Fargate container, API Gateway → ALB. The `MetricsRepository` interface means the container code never touches the DynamoDB SDK directly.

### Flow 2: CSV Upload → ETL Pipeline (Changed)

```mermaid
sequenceDiagram
    participant Volunteer as Volunteer
    participant S3 as S3 Upload Bucket
    participant Lambda as Lambda Trigger<br/>(tiny scheduler)
    participant SF as Step Functions
    participant ETL as Fargate ETL Container
    participant Storage as StorageClient
    participant S3PQ as S3 Parquet
    participant Repo as MetricsRepository
    participant DDB as DynamoDB
    participant SNS as SNS

    Volunteer->>S3: Upload CSV
    S3->>Lambda: ObjectCreated event
    Lambda->>SF: StartExecution(file_url)

    rect rgb(232, 245, 233)
        Note over SF,ETL: Step Functions — parallel fan-out (1 task per file)
        SF->>ETL: Run task #1 (file_001.csv)
        SF->>ETL: Run task #2 (file_002.csv)
        SF->>ETL: ... up to MaxConcurrency
    end

    ETL->>Storage: download CSV from S3<br/>(via StorageClient interface)
    Storage->>S3: GetObject
    S3-->>Storage: CSV bytes
    ETL->>ETL: Parse + aggregate<br/>(pandas or DuckDB)
    ETL->>Storage: upload Parquet to S3
    ETL->>Repo: putMetrics(aggregated_data)
    Repo->>DDB: PutItem (hidden behind interface)
    ETL-->>SF: Task success

    alt Task fails
        ETL-->>SNS: Failure alert
        SF->>SF: Retry (2 attempts)
        SF->>SNS: Permanent failure alert
    end
```

**Delta from v1:** Glue (Spark cluster) → Fargate (Python container + Step Functions orchestration). No Spark dependencies — the container uses pandas or DuckDB for in-process aggregation. Each CSV file gets its own Fargate task, running in parallel up to a configured max.

### Flow 3: Validation (Same Logic, New Infra)

```mermaid
sequenceDiagram
    participant Volunteer as Volunteer
    participant CF as CloudFront + WAF
    participant ALB as ALB
    participant API as Fargate API Container
    participant Repo as ValidationRepository
    participant Aurora as Aurora Postgres

    Volunteer->>CF: POST /validate
    CF->>ALB: Route to Fargate
    ALB->>API: Forward request
    API->>API: Checksum validation
    API->>API: QR code cross-check
    API->>Repo: saveRecord(validation_data)
    Repo->>Aurora: INSERT (standard Postgres SQL)
    Aurora-->>Repo: Success
    Repo-->>API: Saved
    API-->>CF: 200 OK
    CF-->>Volunteer: Validated
```

**Delta from v1:** Lambda → Fargate. The validation logic (checksum + QR cross-check) is identical — only the runtime changes. `ValidationRepository` uses standard Postgres SQL, so no Aurora-specific APIs leak into the container code.

---

## Portability Reference

### Compute — Fargate → GCP Cloud Run / Azure Container Apps

The same Docker image runs on all three clouds:

| Cloud | Service | How to Deploy |
|-------|---------|---------------|
| **AWS** | Fargate | `ecs run-task --task-definition pprcv-api` |
| **GCP** | Cloud Run | `gcloud run deploy --image gcr.io/ppcrv/api` |
| **Azure** | Container Apps | `az containerapp create --image ppcrv.azurecr.io/api` |

The Dockerfile doesn't change. The container registry changes (ECR → Artifact Registry → ACR), and the IaC wiring changes (Terraform `aws_ecs_task_definition` → `google_cloud_run_service` → `azurerm_container_app`).

### ETL Orchestration

| Cloud | Orchestrator | Migration |
|-------|-------------|-----------|
| **AWS** | Step Functions | — |
| **GCP** | Cloud Workflows | Rewrite orchestration (container image stays the same) |
| **Azure** | Logic Apps | Rewrite orchestration (container image stays the same) |

Step Functions → Workflows / Logic Apps is a config rewrite, not a code rewrite. The Fargate/Cloud Run/Container Apps ETL container doesn't change.

### Aurora Serverless v2 (Standard Postgres Connection)

Aurora Serverless v2's auto-scaling (0.5–16 ACU) is AWS-specific. When moving clouds:

| Cloud | Service | Scaling Behavior |
|-------|---------|-----------------|
| **AWS** | Aurora Serverless v2 | Auto-scales 0.5–16 ACU based on load |
| **GCP** | Cloud SQL (Postgres) | Manual instance sizing, no auto-scale-to-near-zero |
| **Azure** | Azure Database (Postgres) | Manual tier selection (General Purpose, Memory Optimized) |

**Migration path:** `pg_dump` Aurora → `pg_restore` into the target Postgres. Connection string change in the container config. The app continues using vanilla Postgres SQL — no code changes.

The **trade-off**: On GCP/Azure, you'd run a fixed-size Postgres instance instead of Aurora's scale-to-near-zero. This means the idle cost on GCP/Azure would be higher (full instance price, ~$25–40/mo vs Aurora's ~$8/mo with 0.5 ACU auto-shutdown).

### DynamoDB (Repository Swap)

Access patterns in this project are simple (single-item lookups + writes). Migration:

```python
# AWS implementation (today)
class DynamoDBMetricsRepository:
    def get_metrics(self, precinct: str) -> dict:
        response = self.table.get_item(Key={'pk': f'precinct#{precinct}'})
        return response.get('Item', {})

# GCP implementation (future)
class FirestoreMetricsRepository:
    def get_metrics(self, precinct: str) -> dict:
        doc = self.db.collection('metrics').document(f'precinct#{precinct}').get()
        return doc.to_dict() or {}
```

Both implement the same `MetricsRepository` interface. The container code that calls `repo.get_metrics(precinct)` doesn't know or care which cloud it's running on.

**Migration effort:** ~4 days (implement Firestore impl + data migration script + testing).

---

## Migration Path to GCP or Azure

### Step 1: Verify Abstractions (before any move)

Audit all container code for direct AWS SDK usage. Every `boto3` / `aws-sdk` import must live inside an `*Impl` class, nowhere else.

### Step 2: Write Target Cloud Implementations

Implement the four interfaces for the target cloud:
- `FirestoreMetricsRepository` (or `CosmosMetricsRepository`)
- `PostgresValidationRepository` (unchanged — vanilla Postgres)
- `GCSStorageClient` (or `BlobStorageClient`)
- `PubSubMessageQueue` (or `ServiceBusMessageQueue`)

### Step 3: Deploy Container Images

```bash
# Push the existing Docker image to the target cloud registry
docker tag pprcv-api:latest gcr.io/ppcrv/api:latest   # GCP
docker tag pprcv-api:latest ppcrv.azurecr.io/api:latest  # Azure
docker push gcr.io/ppcrv/api:latest

# Deploy to target compute service
gcloud run deploy pprcv-api --image gcr.io/ppcrv/api:latest --region asia-southeast1
```

### Step 4: Provision Infrastructure (Terraform)

```hcl
# Add GCP provider to existing Terraform code
provider "google" {
  project = "ppcrv-prod"
  region  = "asia-southeast1"
}

# Same logical resources, different provider resources
resource "google_cloud_run_service" "api" { ... }
resource "google_sql_database_instance" "postgres" { ... }
resource "google_storage_bucket" "data" { ... }
```

### Step 5: Migrate Data

| Data Source | Migration Method |
|------------|-----------------|
| Aurora (Postgres) | `pg_dump` → `pg_restore` into Cloud SQL / Azure Postgres |
| DynamoDB | Export to JSON → import into Firestore / Cosmos DB (or use AWS DataSync) |
| S3 | `gsutil` / `azcopy` for bulk transfer |

### Step 6: Flip Config + Test

```bash
# Change one environment variable
CLOUD_PROVIDER=gcp  # was: aws

# Restart containers — they pick up new implementations
kubectl rollout restart deployment/ppcrv-api  # or equivalent
```

---

## Open Items

| # | Item | Status |
|---|------|--------|
| 1 | Decide: keep ALB always-on during idle or destroy/recreate | Open |
| 2 | Choose Docker base image (python:3.11-slim vs node:20-slim) | Open — depends on language choice |
| 3 | Choose web framework for API container (FastAPI / Express / Go) | Open |
| 4 | Choose ETL processing library (pandas vs DuckDB vs both) | Open — benchmark with real CSV data |
| 5 | Implement Step Functions state machine for ETL fan-out | Open |
| 6 | Define container resource sizing (vCPU / memory per task) | Open |
| 7 | Decide: Aurora auto-shutdown schedule in dev (see cost-re-arch.md) | Open |

---

## Change Log

All changes to this repository's documentation are tracked in **[docs/CHANGES.md](docs/CHANGES.md)**.