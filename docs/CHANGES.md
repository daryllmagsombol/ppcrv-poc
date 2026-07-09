# Change Log

Tracks all edits made to documentation in the `pprcv-poc` repository. Entries are listed in reverse chronological order (newest first).

> [!NOTE]
> This file is manually maintained alongside each edit. When modifying any documentation file (`README.md`, `cost-arch-v1.md`, architecture docs, etc.), prepend a new entry to this log.

---

## Format

Each entry follows this structure:

```
## YYYY-MM-DD — <short title>

**Files changed:** <file paths>
**Author:** <name / agent>
**Summary:** <1-2 sentence description>

### What changed
- <bullet point>

### Why
- <rationale>
```

---

## 2026-07-09 — Added local ETL testing setup with DuckDB + Postgres

**Files changed:** `pyproject.toml` (new), `src/etl/__init__.py` (new), `src/etl/models.py` (new), `src/etl/processor.py` (new), `tests/etl/__init__.py` (new), `tests/etl/test_processor.py` (new), `tests/etl/fixtures/sample.csv` (new), `tests/etl/fixtures/multiple.csv` (new), `tests/etl/fixtures/edge.csv` (new), `scripts/load_ref_data.py` (new), `etl/USE.md` (new), `docs/CHANGES.md`, `docs/superpowers/specs/2026-07-09-etl-local-testing-design.md` (new), `docs/superpowers/plans/2026-07-09-etl-local-testing.md` (new)
**Author:** Team Leader (subagents)
**Summary:** Set up local ETL testing infrastructure for PPCRV v3 election monitoring using DuckDB (CSV → Parquet aggregation) and Postgres (reference data). Pure Python + pytest, no Docker or cloud SDK needed.

### What changed

**Project scaffold:**
- `pyproject.toml` with dev deps: duckdb, pytest, pyarrow, psycopg2-binary
- Package structure under `src/etl/` and `tests/etl/`

**Data models (`src/etl/models.py`):**
- `AggregationResult` dataclass with `total_votes`, `precinct_count`, `contest_count`, `output_files`

**Core processor (`src/etl/processor.py`):**
- `parse_and_aggregate(csv_path, output_dir, partition_by)` — reads CSV via DuckDB `read_csv_auto`, aggregates `SUM(VOTES_AMOUNT)` grouped by precinct/contest/candidate/party, writes partitioned Parquet files

**Postgres reference data loader (`scripts/load_ref_data.py`):**
- Idempotent loader (`INSERT ... ON CONFLICT DO NOTHING`) for `pprcv_local` DB
- Loads 4 reference tables (parties, contests, precincts, candidates) from `sample-csv/`
- Fixes party-list candidates with empty `PARTIES_CODE` → SQL NULL (FK constraint)

**Test suite (`tests/etl/test_processor.py`):**
- 6 pytest tests: simple aggregation, multiple precincts, empty CSV, valid Parquet, idempotent output, real-world `results.csv`

**Design docs:**
- `docs/superpowers/specs/2026-07-09-etl-local-testing-design.md` — design decisions and Approach 1 rationale
- `docs/superpowers/plans/2026-07-09-etl-local-testing.md` — 3-task implementation plan with step-by-step instructions

### Why
- Needed a local ETL testing setup that works without cloud dependencies or Docker
- DuckDB handles CSV → Parquet aggregation in-process, no Spark/Flink needed
- Postgres reference data validates FK assumptions against real `sample-csv/` data (caught party-list NULL issue)
- Real data from `sample-csv/` contains 141K+ rows across 4 reference tables + results.csv

---

## 2026-07-08 — Reviewed and improved v3 architecture docs

**Files changed:** `README.md`, `docs/cost-re-arch-v3.md`
**Author:** Daryll (Claude)
**Summary:** Reviewed the v3 architecture docs for gaps in Redis operational guidance, cost calculation errors, and missing request flows. Added comprehensive Redis security, monitoring, and operational sections. Fixed annual projection math discrepancy and broken links.

### What changed

**Cost doc fixes (cost-re-arch-v3.md):**
- Fixed broken link: `readme-re-arch-v3.md` → `../README.md` (v3 architecture is now in README.md)
- Fixed annual projection math discrepancy: ~$790 was incorrect, corrected to ~$821 based on detailed breakdown
- Clarified Redis auto-shutdown idle cost: $0/month (stopped), not $5.71/month (that's dev environment cost)
- Updated all dependent calculations (idle month: ~$49, annual: ~$821, comparison: $130/year cheaper than v2)
- Added per-cloud Redis cost disclaimer: GCP/Azure pricing is preliminary, needs verification with cloud calculators
- Added Lambda Trigger free tier clarification: 500 peak invocations is well within 1M/month free tier

**README.md — New Redis operational sections:**
- **Redis Memory Sizing:** Calculated ~60 MB needed for 95K precincts, 1.37 GB instance = 23x headroom
- **Redis Security:** AUTH token, TLS in-transit, VPC security groups, encryption at rest, IAM auth option
- **Redis Connection Management:** Connection count (20 = fine), timeout config, retry strategy, health checks
- **Data Consistency Model:** Write order (S3 first, then Redis), failure scenarios and recovery paths
- **ETL Watchdog Detail:** Check frequency (60s), stale timeout (10 min), retry logic (3 attempts), permanent failure handling
- **Redis Pub/Sub Reliability Caveat:** Fire-and-forget caveat, mitigation via reconciliation job (hourly) and startup refresh
- **Redis Key TTL Strategy:** Table of all key patterns with TTL rationale (election data = no TTL, temporary keys = TTL)
- **Redis Monitoring Metrics:** CloudWatch metrics to monitor (memory, connections, hit rate, CPU, evictions) with alarm thresholds
- **RDB Snapshot Storage Clarification:** ElastiCache manages storage automatically, no S3 bucket needed, restore procedure
- **ETL Scaling Strategy:** Manual scaling for MVP, auto-scaling option via CloudWatch alarm on queue depth

**README.md — New request flow:**
- **Flow 5 — Reconciliation:** Added sequence diagram showing CloudWatch Scheduled → Athena → S3 Parquet vs Redis → SNS alert/rebuild

### Why
- User requested review of v3 docs for gaps and improvements
- Redis is a new service in v3 — the docs lacked operational guidance for security, monitoring, and failure handling
- The annual projection had a math discrepancy (~$790 vs ~$883) that needed correction
- The reconciliation flow (Flow 5) was in v1/v2 but missing from v3
- Redis auto-shutdown cost was incorrectly stated as $5.71/month (that's dev cost, not idle cost)

---

## 2026-07-08 — Created v3 cloud-agnostic architecture (Redis-based)

**Files changed:** `readme-re-arch-v3.md` (new), `cost-re-arch-v3.md` (new)
**Author:** Daryll (Claude)
**Summary:** Designed a third iteration of the cloud-agnostic architecture that reduces service count from 8+ to 5 by consolidating DynamoDB, Step Functions, and SNS real-time messaging into a single Redis instance. The goal: fewer services to reimplement per cloud, faster performance, and lower cost.

### Decisions made through Q&A

- **Portability scope:** Keep option open for GCP/Azure, not multi-cloud deployment. v3 targets ~5 services per cloud instead of v2's 8+.
- **Fast KV database:** Redis (ElastiCache / Memorystore / Azure Cache) replaces DynamoDB. Same `redis-py` client everywhere, sub-millisecond reads. Also serves as job queue and pub/sub.
- **ETL orchestration:** Redis LPUSH/BRPOP replaces Step Functions. ETL container polls Redis for jobs — no cloud orchestrator needed.
- **Relational DB:** Aurora Serverless v2 with standard Postgres SQL only (`psycopg2`). No Aurora-specific features. Migration is `pg_dump` → `pg_restore`.
- **Messaging:** Redis pub/sub for real-time events (cache invalidation, cluster notifications). SNS/SQS retained only for durable DLQ and operator alerts.
- **UI hosting:** Static SPA in object storage + CDN per cloud (same pattern as v2). Rejected monolith-in-container approach due to cost/performance at 50M requests.
- **Abstraction interfaces:** Reduced from 4 (v2) to 2 (v3). Only StorageClient and MessageQueue need per-cloud implementations. Redis and Postgres use standard protocols — no abstraction needed.
- **S3 upload trigger:** Lambda/Cloud Function/Azure Function per cloud. 10 lines each — not worth abstracting.
- **Edge layer:** Per-cloud CDN + WAF + DNS (same as v2 pattern).

### Architecture delta

- **Removed:** DynamoDB (Metrics + Status tables), Step Functions, SNS real-time path
- **Added:** Redis (cache + queue + pub/sub in one instance), Redis Rebuild Script (for auto-shutdown)
- **Changed:** Aurora used with standard SQL only, SNS/SQS reduced to durable alerts only, interfaces cut from 4 to 2
- Single Redis instance (`cache.t3.small`) handles three workloads: vote metrics KV store, ETL job queue (LPUSH/BRPOP), and real-time pub/sub
- Redis Rebuild Script uses Athena/BigQuery/Synapse to rebuild Redis from S3 Parquet after idle-period shutdown

### Key Redis data model
- **Vote metrics:** `PRECINCT:{id}` → JSON, `CONTEST:{name}` → ZSET (leaderboard), `STATUS:{key}` → status string
- **Job queue:** `etl:queue` (pending), `etl:processing` (active), `etl:failed` (dead)
- **Pub/sub:** `etl:done`, `etl:error` channels for in-cluster events

### Cost impact
| Metric | v1 (Lambda) | v2 (Fargate + DDB) | v3 (Fargate + Redis) |
|--------|------------|--------------------|----------------------|
| Peak month (optimized) | ~$402 | ~$390 | **~$345** |
| Idle month (optimized, auto-shutdown) | ~$65 | ~$51 | **~$48** |
| Annual (full auto-shutdown) | ~$1,117 | ~$951 | **~$883** |
| Annual (always-on) | ~$1,117 | ~$1,171 | ~$1,159 |
| Services per cloud | 10+ | ~8 | **~5** |
| Abstraction interfaces | 4 | 4 | **2** |

**Finding:** v3 is the cheapest annually ($883) with full auto-shutdown, but requires a Redis Rebuild Script (~100 lines). Without auto-shutdown, v3 is ~$208 more expensive than v2 due to Redis always-on idle cost. The rebuild script is the price of the savings.

### Why
- User request: fewer services to reimplement when switching clouds. v2 had 8+ cloud-specific services.
- Redis emerged as the consolidation point: it replaces three v2 services (DynamoDB Metrics, DynamoDB Status, Step Functions) and absorbs SNS real-time messaging.
- Redis and Postgres use standard protocols — no abstraction interfaces needed. Only StorageClient and MessageQueue remain.
- The trade-off: v3 is $68/year cheaper than v2 at full auto-shutdown, but requires additional code (rebuild script + ETL watchdog).

---

## 2026-07-08 — Added v3 operational optimizations and fixed cross-references

**Files changed:** `README.md`, `docs/readme-re-arch-v3.md`, `docs/cost-re-arch-v3.md`, `docs/CHANGES.md`
**Author:** Daryll (Claude)
**Summary:** Identified and documented 8 post-design optimizations for v3, updated cost model with Multi-AZ Redis and RDB snapshots, and fixed all cross-document markdown links after file renames.

### Optimizations added
- **CloudFront edge-cache API responses** — 30s TTL on `/api/metrics`, reduces API load 70-90%
- **Graceful ETL shutdown** — SIGTERM handler prevents stale jobs when Fargate scales down
- **Presigned S3 upload URLs** — Volunteers upload 2GB CSVs directly to S3, bypassing API container
- **PgBouncer sidecar** — Postgres connection pooling, prevents 400+ connection exhaustion
- **Redis RDB snapshots** — 15-min snapshots during election week, restart time: 5 min → 30 sec
- **CSV schema validation** — Lambda Trigger validates CSV headers before queuing, prevents bad data wasting ETL compute
- **Multi-AZ Redis** — Primary + replica for HA (optional, post-MVP, ~$25/mo extra)
- **Redis-backed rate limiting** — Per-API-key sliding window (noted for post-MVP, WAF used for MVP)

### Cost updates
- Added Multi-AZ Redis section: ~$50/mo for primary + replica
- Added RDB snapshots: ~$0.50/mo storage, reduces restart from 5 min to 30 sec
- Updated comparison table with Multi-AZ line item

### Link fixes
- Fixed all cross-document markdown links after v1/v2/v3 file renames
- `README.md` → `docs/readme-arch-v1.md`, `cost-arch-v1.md` → `docs/cost-arch-v1.md`, etc.
- Verified no broken references remain

### Why
- Design review identified gaps in HA, graceful shutdown, and edge caching
- File renames broke internal cross-references
- Documenting operational details (graceful shutdown, presigned URLs) prevents surprises during implementation

---

## 2026-07-08 — Reviewed and improved Re-Architecture docs

**Files changed:** `readme-re-arch-v2.md`, `cost-re-arch-v2.md`
**Author:** Daryll (Claude)
**Summary:** Reviewed the re-architecture docs for gaps, inconsistencies, and missing operational/security considerations. Added a comprehensive Operations & Security section, fixed cost inconsistencies, and updated Open Items with decisions.

### What changed

**Fixes:**
- Fixed architecture diagram label: "One Container Image" → "API + ETL Containers" (misleading since there are two distinct container types)
- Fixed Lambda S3 Trigger inconsistency: moved from "Removed Services" to "Unchanged" in cost-re-arch-v2.md (the trigger still exists in v2, now triggers Step Functions instead of Glue)
- Updated all cost calculations to reflect the $1 difference (~$665 peak instead of ~$664)
- Fixed Python version in Open Items: 3.11 → 3.12 (3.11 EOL in ~2 years)
- Fixed kubectl command → ECS command for Fargate deployment (Fargate uses ECS, not Kubernetes)
- Clarified Step Functions cost calculation (500 executions × 3 transitions × $0.025/1K)

**New section — Operations & Security (readme-re-arch-v2.md):**
- **Container image security:** ECR scanning, base image updates, image signing, least privilege (task vs execution role), secrets injection, awslogs log driver
- **Cold start mitigation:** min_tasks=1 during election, scheduled warming, ALB slow start, pre-provisioning before election
- **Auto-scaling configuration:** min/max tasks, scale-out metrics, cooldowns, target tracking for both API and ETL containers
- **Multi-AZ & networking:** VPC/subnet config, security group rules, awsvpc networking, ALB health check config, NAT Gateway considerations
- **CI/CD pipeline for containers:** Build → test → scan → push → deploy pipeline with image tagging strategy (Git SHA, not :latest)
- **Rollback strategy:** Container crash loop, bad deployment, Fargate outage (Lambda hot standby for first election cycle), ALB failure
- **ETL memory sizing:** pandas vs DuckDB memory comparison, recommendation to use DuckDB, chunked processing fallback, bump to 8 GB
- **Local development experience:** Docker Compose with localstack, CLOUD_PROVIDER=local config, local Postgres, test fixtures

**New section — Step Functions Express vs Standard (readme-re-arch-v2.md):**
- Added comparison table with pricing, use cases, and trade-offs
- Recommendation: Standard Workflows for initial deployment (better observability, exactly-once)

**Updated What's Unchanged table:**
- Added reconciliation flow reference (CloudWatch Scheduled → Athena → S3 Parquet vs DynamoDB → SNS)
- Note that it's unchanged since Athena queries S3 Parquet directly, independent of ETL runtime

**Updated Open Items table:**
- Marked ALB decision as decided (keep always-on, see cost-re-arch-v2.md)
- Marked ETL library as decided (use DuckDB, see ETL Memory Sizing)
- Marked container resource sizing as decided (API: 1 vCPU/2 GB, ETL: 1 vCPU/8 GB)

### Why
- User requested review of re-architecture docs for gaps and improvements
- The docs were thorough on architecture and cost but lacked operational/security guidance for actually running the containers in production
- The Lambda S3 Trigger inconsistency between the two docs needed correction
- Adding cold start mitigation, auto-scaling, networking, and rollback guidance makes the docs actionable for implementation
- ETL memory sizing concern (pandas OOM on 2 GB CSVs) is a real production risk that needed to be documented

---

## 2026-07-08 — Created cloud-portable Re-Architecture (Fargate-based)

**Files changed:** `readme-re-arch-v2.md` (new), `cost-re-arch-v2.md` (new)
**Author:** Team Leader (Claude)
**Summary:** Designed a cloud-portable variant of the PPCRV architecture that replaces AWS-specific services (Lambda, Glue, API Gateway) with Fargate containers, enabling the same Docker images to run on GCP Cloud Run or Azure Container Apps with minimal changes.

### Decisions made through Q&A
- **Portability scope:** Keep the option open for GCP/Azure, not multi-cloud deployment
- **Compute:** Replace Lambda (3 functions) + Glue with Fargate containers (one container image for API + one for ETL)
- **API routing:** Replace API Gateway with ALB (cheaper at scale, more portable to GCP Cloud LB / Azure App Gateway)
- **Database:** Keep DynamoDB (with Repository abstraction for later swap) and Aurora Serverless v2 (accessed via standard Postgres connection only)
- **Other services:** Keep S3, SNS, SQS, CloudFront, WAF, Route 53, CloudWatch — all behind abstraction interfaces so swapping clouds means writing new impls, not touching container code

### Architecture delta
- **Removed:** API Gateway, Lambda Vote Metrics, Lambda Validation, AWS Glue (Spark)
- **Added:** Fargate API container, Fargate ETL container, ALB, Step Functions (ETL orchestration)
- **Abstraction layer:** Four interfaces (MetricsRepository, ValidationRepository, StorageClient, MessageQueue) with AWS impls today and GCP/Azure impls later
- Single `CLOUD_PROVIDER` env var flips the entire backend — same Docker image everywhere

### Cost impact (self-review corrected arithmetic errors)
| Metric | v1 (Lambda) | v2 (Fargate) |
|--------|------------|--------------|
| Peak month (un-optimized) | ~$703 | ~$664 (~5% cheaper) |
| Peak month (optimized, Business plan) | ~$402 | ~$390 |
| Idle month (un-optimized) | ~$74 | ~$93 (+$19 for ALB) |
| Idle month (optimized, Aurora auto-shutdown) | ~$65 | ~$51 |
| Annual (optimized, auto-shutdown) | ~$1,117 | **~$951** ($166 cheaper) |
| Annual (optimized, always-on Aurora) | ~$1,117 | ~$1,171 ($54 more) |

**Counterintuitive finding:** The Fargate architecture can be **cheaper** than Lambda with Aurora auto-shutdown. The ALB always-on cost (~$202/year) is offset by removing API Gateway + Lambda + Glue (~$110/month peak). The "cost premium for portability" is $0/year with auto-shutdown, or ~$54/year without it.

### Why
- User request: make the architecture compatible with other cloud providers (GCP or Azure) while building on AWS now
- Fargate containers are the portability anchor — Docker images run on any cloud
- Repository interfaces ensure platform-specific SDKs don't bleed into application code

---

## 2026-07-03 — Created CloudFormation/SAM exploration document (CLOUDFORMATION.md)

**Files changed:** `docs/CLOUDFORMATION.md` (new), `docs/TERRAFORM.md`, `README.md`
**Author:** Team Leader (Claude)
**Summary:** Created a comprehensive document exploring what the PPCRV platform would look like using AWS CloudFormation + SAM instead of Terraform. Since Terraform hasn't been written yet (greenfield project), the document is a side-by-side comparison for choosing which IaC tool to start with.

### What changed
- Created `docs/CLOUDFORMATION.md` with:
  - SAM template architecture — how the 7 planned modules map to SAM/CF resources
  - Example `template.yaml` structure showing Lambda, DynamoDB, Aurora, CloudFront, Glue
  - Single-pipeline CI/CD workflow using `sam build && sam deploy`
  - Multi-environment strategy using `samconfig.toml` per environment
  - Greenfield setup-time comparison (no migration needed)
  - Side-by-side comparison table (Terraform vs SAM across 12 criteria)
  - Recommendation: **SAM/CloudFormation** as the better starting point for a pure-AWS serverless project
- Updated `docs/TERRAFORM.md` — added disclaimer at top that this is a proposal, not a live setup
- Updated `README.md` — changed "Infrastructure is provisioned via Terraform" to "Infrastructure will be provisioned via Infrastructure-as-Code" with links to both options

### Why
- The user clarified Terraform hasn't been implemented yet — this changes the decision from "should we migrate?" to "which tool should we start with?"
- Without the migration cost anchor, SAM's unified pipeline and managed state make it the stronger default for a pure-AWS serverless project
- Both options remain documented so the team can make an informed choice

---

## 2026-07-03 — Created dev environment cost estimate (COSTS-DEV.md)

**Files changed:** `docs/COSTS-DEV.md` (new), `README.md`
**Author:** Team Leader (Claude)
**Summary:** Created a cost estimate for the shared dev AWS environment — scaled-down version of the full production stack for 3 developers with auto-shutdown via EventBridge Scheduler.

### What changed
- Created `docs/COSTS-DEV.md` with:
  - Assumptions & Schedule (3 devs, weekdays, same TZ, ~9h/day)
  - Auto-shutdown strategy (Aurora paused after hours and weekends via EventBridge Scheduler)
  - Per-service cost breakdown for all 12+ AWS services (scaled down)
  - Monthly summary (~$29 realistic floor / ~$36 budget)
  - Annual projection (~$348/year)
  - Comparison with production costs
  - Implementation guidance for the auto-shutdown cron rules
- Updated `README.md` Terraform section: dev cost line changed from "~$0.11/mo (S3 + DynamoDB for state)" to "~$29/mo (scaled-down AWS stack with auto-shutdown) + ~$0.11/mo (Terraform state); see COSTS-DEV.md"

### Why
- The user needs a realistic dev budget for the shared AWS account
- Auto-shutdown is the critical optimization — Aurora's 0.5 ACU minimum costs ~$29/mo 24/7, but only ~$8/mo with scheduled pauses
- Having dev cost documented alongside prod cost gives the team full visibility into monthly AWS spend

---

## 2026-07-03 — Removed duplicate outdated architecture-level comparison table from README.md

**Files changed:** `README.md`
**Author:** Team Leader (Claude)
**Summary:** The old simplified architecture comparison table (showing $15 idle / $220 peak) was a duplicate left behind when the updated detailed table ($98 idle / $548 peak with Route 53, Secrets Manager, Observability) was added. Removed the stale duplicate.

### What changed
- Removed the duplicate table and its "Savings: ~70% at peak..." caption from the Cost Comparison section
- The correct, updated Architecture-Level table (line 542) remains
- No data loss — the old table's values contradicted the audited totals in cost-arch-v1.md

### Why
- The table was a stale duplicate from the pre-audit draft
- Two tables with different numbers was confusing and risked the wrong numbers being cited

---

## 2026-07-03 — Fixed arithmetic error in optimized annual projection; documented CloudFront plan-switching model

**Files changed:** `cost-arch-v1.md`, `README.md`
**Author:** Team Leader (Claude)
**Summary:** The user asked whether the CloudFront Business plan is meant to be subscribed only for the election month — that question exposed a real arithmetic error. The optimized annual had been reported as **~$816/year** in one section and **~$875/year** in another (both wrong). Recomputed with a proper plan-switching model and corrected to **~$1,117/year**.

### Root cause
The previous optimized annual equation was: "$402 (peak) + 11 × ~$74 (idle) = ~$816/year". This was wrong on two counts:
1. **Arithmetic** — $402 + (11 × $74) = **$1,216**, not $816. A character transposition error.
2. **Idle baseline** — $74 was inherited from the un-optimized idle, which included pay-as-you-go CloudFront/Route 53/Secrets line items that are absorbed or zeroed under the optimized plan-switching scenario. The correct optimized idle baseline is **~$65** (not $74).

### What changed — cost-arch-v1.md
- Replaced the vague "annual (with 11 idle months @ ~$74)" with an explicit plan-switching model table
- Added "Plan-Switching Mechanics — Verify With AWS" subsection listing assumptions that must be confirmed (month-to-month switching, WAF attachment, etc.)
- Added two idle scenarios: WAF attached (~$65/mo, recommended) vs WAF detached (~$60/mo)
- Itemized the idle month breakdown so $65/month is auditable
- Updated Comparison with Initial EC2 Proposal table: $1,117 (WAF attached) / $1,062 (WAF detached) instead of $816
- Updated xychart-beta bar from `[8750, 1517, 816]` to `[8750, 1517, 1117]`
- Updated savings claim from "~90% cheaper" to "~87% cheaper (WAF attached) / ~88% (WAF detached)"
- Added CAUTION callout explicitly noting the arithmetic error and correction

### What changed — README.md
- Annual Projection table: added ~$1,062 (WAF detached) row; corrected optimized column to ~$1,117
- Updated Key Insights: idle ~$65/mo (was $74), annual ~$1,117 (was $816), savings ~87% (was ~90%)
- Added IMPORTANT callout describing the plan-switching assumption
- Added CAUTION callout explicitly noting the $816 was an arithmetic error
- Comprehensive Monthly Estimate: added "Optimized idle — CF Free plan, WAF attached" row (~$65)

### Why
- The user's question "do I only subscribe for one month?" was the right question — it forced a re-examination of the cost model and exposed both an arithmetic error and a logical inconsistency
- The correct ~$1,117 is still ~87% cheaper than the EC2 proposal (~$8,750/year), which is the real story
- Documenting the plan-switching model creates a verification checkpoint — the entire optimized scenario depends on month-to-month switching being possible

---

## 2026-07-03 — Synced README Cost Comparison with audited cost-arch-v1.md totals

**Files changed:** `README.md`
**Author:** Team Leader (Claude)
**Summary:** Updated the README's Cost Comparison section to reflect the audited numbers from cost-arch-v1.md (previously still showed the old $630 / $367 / $1,445 figures).

### What changed
- **Architecture-Level Cost Comparison table** — added rows for **Route 53** ($1 idle / $21 peak) and **Secrets Manager** ($3 idle / $0 peak); Glue idle cost corrected from $5 to $0 (first 1M objects free); CloudFront row updated to $402 peak (ap-southeast-1 rate correction); S3 storage row updated to $5 idle.
- **Comprehensive Monthly Estimate table** — replaced the 7-category breakdown with the audited figures:
  - Edge & Networking now includes Route 53 + Secrets Manager: $467.04 (was $393.81)
  - Compute: $110.87 (was $115.07)
  - Database: $74.84 (was $73.34)
  - Storage: $5.29 (was $3.10)
  - Un-optimized total: **~$703** (was ~$630)
  - Optimized total: **~$402** (was ~$367)
- **Annual Projection table** — Updated to ~$8,750 / ~$1,517 / **~$816** (was ~$8,750 / ~$1,710 / ~$1,445).
- **Savings claim** — updated from "~80% to ~83%" to "~83% (un-optimized) to ~90% (optimized)".
- **Key Insights** — rewrote to emphasize:
  - Idle cost ~$74/month (down from ~$98)
  - CloudFront Business flat-rate plan ($200/mo, no overage charges) as the single biggest cost optimization
  - CloudFront data transfer remains the dominant peak-period cost (~67%)
  - Optimized annual ~$816 (was ~$1,445)
- Added note flags at the top of each table indicating that figures were audited 2026-07-03 against AWS ap-southeast-1 public pricing, and pointing to the cost-arch-v1.md Notes & Disclaimers for verification status.

### Why
- After the cost-arch-v1.md audit, the README was left out of sync — its Cost Comparison section still cited the pre-audit totals.
- The user explicitly asked whether the README was also updated; the honest answer was "no, I'll fix it now".
- Keeping these two documents in sync is critical since the README is the entry point and cost-arch-v1.md is the detailed companion.

---

## 2026-07-03 — Removed duplicate outdated architecture-level comparison table from README.md

**Files changed:** `README.md`, `CHANGES.md`
**Author:** Team Leader (Claude)
**Summary:** The old simplified architecture comparison table (showing $15 idle / $220 peak) was a duplicate left behind when the updated detailed table ($98 idle / $548 peak with Route 53, Secrets Manager, Observability) was added. Removed rows 608-619 from README.md.

### What changed
- Removed duplicate table and its "Savings: ~70% at peak..." caption
- The correct, updated Architecture-Level table at line 542 remains
- No data loss — the old table's values contradicted the audited totals in cost-arch-v1.md

### Why
- The table was a stale duplicate from the pre-audit draft and contradicted the correct figures
- Having two tables with different numbers was confusing and risked the wrong numbers being cited

---

## 2026-07-03 — Fixed arithmetic error in optimized annual projection; documented CloudFront plan-switching model

**Files changed:** `cost-arch-v1.md`, `README.md`
**Author:** Team Leader (Claude)
**Summary:** The user asked whether the CloudFront Business plan is meant to be subscribed only for the election month and whether idle months were costed correctly. That question exposed a real arithmetic error — the optimized annual had been reported as **~$816/year** in one section of cost-arch-v1.md and **~$875/year** in another (both wrong). Recomputed with a proper plan-switching model and corrected to **~$1,117/year**.

### What changed

**Root cause — an arithmetic error I should have caught earlier:**
- The previous optimized annual equation in cost-arch-v1.md was: "$402 (peak) + 11 × ~$74 (idle) = ~$816/year". This was wrong on two counts:
  1. **Arithmetic** — $402 + (11 × $74) actually equals **$1,216**, not $816. A character transposition error.
  2. **Idle baseline** — $74 was inherited from the un-optimized idle, where it included pay-as-you-go CloudFront/R53/Secrets line items that are absorbed or zeroed under the optimized plan-switching scenario. The correct optimized idle baseline is **~$65** (not $74) once the CloudFront Free plan and SSM Parameter Store swap are applied.

**Replaced the hand-wavy "annual (with 11 idle months @ ~$74)" line with an explicit plan-switching model:**

| Period | Plan | Cost |
|--------|------|------|
| Peak month (1) | CloudFront Business ($200/mo, no overage) | ~$402 |
| Idle months (11) | CloudFront Free ($0/mo) + WAF attached | ~$65 each |
| **Optimized annual total** | | **~$1,117/year** |

**Added a new "Plan-Switching Mechanics — Verify With AWS" subsection** in cost-arch-v1.md listing explicit assumptions that must be confirmed:
- Can CloudFront plans be switched month-to-month? (assumed yes)
- Is there a switching penalty? (assumed no)
- Does WAF remain attached when the CF plan changes? (assumed yes)
- Does the Business plan absorb WAF request fees, or only the WAF feature itself? (kept WAF request fees outside the plan as a conservative assumption)

**Added two idle scenarios** — idle month with WAF stays attached (~$65/mo, recommended for security) vs WAF detached during idle (~$60/mo, saves $55/year but loses year-round protection). Recommended keeping WAF attached given the small saving.

**Idle month breakdown itemized explicitly** in cost-arch-v1.md so the $65/month figure is auditable:
- CF Free plan: $0 (covers 1M req / 100 GB — idle traffic is trivial)
- WAF Web ACL + minimal inspection: $5
- Route 53 (hosted zone + minimal queries): $1
- API Gateway (idle ~100K req): $0 (free tier)
- Lambda (idle ~50K invocations): $0 (free tier)
- Glue: $0
- Aurora Serverless v2 (0.5 ACU min + storage): $40
- DynamoDB (storage only): $1.43
- S3 (121 GB + lifecycle): $5
- CloudWatch (dashboards + alarms + log storage, no new ingest): $11
- Athena: $0.60
- Total: ~$64 (rounded to $65 for buffer)

**Updated the Comparison with Initial EC2 Proposal table** in cost-arch-v1.md to use $1,117 (with WAF attached) and $1,062 (with WAF detached) instead of $816.

**Updated the `xychart-beta` annual comparison** in cost-arch-v1.md from `bar [8750, 1517, 816]` to `bar [8750, 1517, 1117]`.

**Updated the savings claim** from "~90% cheaper annually" to "~87% cheaper annually" (WAF attached) / "~88% cheaper annually" (WAF detached).

**Synced README.md:**
- Annual Projection table updated: ~$8,750 / ~$1,517 / **~$1,117** / ~$1,062 (added "WAF detached" row)
- "Annual savings" claim updated to "~83% (un-optimized) to ~87% (optimized, WAF attached)"
- Added IMPORTANT callout describing the plan-switching assumption and linking to cost-arch-v1.md "Plan-Switching Mechanics" subsection
- Added CAUTION callout explicitly noting the previous $816 figure was an arithmetic error and stating the corrected ~$1,117
- Comprehensive Monthly Estimate table updated: replaced single "Optimized ~$402" row with two rows — peak month ($402) and idle month ($65)
- Key Insights updated: "Idle cost ~$65/month" (was $74), "Optimized annual ~$1,117" (was $816), savings "~87% vs EC2" (was ~90%)

### Why
- The user's question "do I only subscribe for one month?" was the right question to ask — it forced me to re-examine the cost model assumption and exposed both an arithmetic error and a logical inconsistency (the optimized idle number was inherited from the un-optimized idle that included line items the optimized scenario eliminates).
- Errors like this are exactly why user review of specs is important — the previous $816 figure looked plausible on first read because the optimized scenario is genuinely much cheaper than un-optimized, but the correct ~$1,117 is still ~87% cheaper than the EC2 proposal, which is the actual story worth telling.
- Documenting the plan-switching model explicitly forces a verification checkpoint — the "month-to-month switching without penalty is assumed but not confirmed" disclaimer is critical because the entire optimized scenario depends on it being possible.

---

## 2026-07-03 — Cost audit: corrected AWS prices, added missed services, added CloudFront flat-rate plan

**Files changed:** `cost-arch-v1.md`
**Author:** Team Leader (Claude)
**Summary:** Audited `cost-arch-v1.md` against current AWS ap-southeast-1 public pricing. Corrected two material price errors (WAF request rate, Glue Catalog storage), applied region-specific rate corrections (CloudFront + Aurora storage), added two previously-missed services (Route 53 DNS, Secrets Manager), and surfaced the new 2026 CloudFront flat-rate Business plan as the single biggest cost optimization.

### What changed

**Price corrections (verified against AWS pricing pages):**
- **WAF request rate:** $1.00/M → **$0.60/M** (verified directly from `aws.amazon.com/waf/pricing/`). Saves ~$20/month.
- **Glue Data Catalog storage:** removed the $5/month flat fee — the **first 1M objects are free**. Saves ~$5/month.
- **CloudFront data transfer (ap-southeast-1):** $0.114/GB → **$0.140/GB** for the first 10 TB/month. Adds ~$68/month to the peak estimate.
- **Aurora Serverless v2 storage (ap-southeast-1):** $0.115/GB-month → **$0.13/GB-month**. Adds ~$1.50/month.

**Services added (previously missed):**
- **Route 53 DNS:** $20.90/month (hosted zone + ~50M standard queries). All 50M public requests must resolve the domain name first.
- **AWS Secrets Manager:** $2.50/month (5 secrets × $0.40 + API calls). Holds DB credentials and API keys for Lambda / Glue. Documented the free-tier alternative (Systems Manager Parameter Store).
- **S3 request operations:** added explicit GET (~$2.00) and PUT (~$0.25) request costs that were bundled into a vague $0.05 line previously.
- **WAF vended logs (CloudWatch):** added ~$1/month for WAF log ingestion beyond the 500 MB free per 1M requests.
- **DynamoDB optional features table:** documented PITR (Point-in-Time Recovery, ~$0.40/mo, recommended for election integrity), Streams (free), Global Tables (not needed), DAX (not needed), GSIs (not needed).

**New optimization — CloudFront Business Flat-Rate Plan:**
- AWS introduced CloudFront flat-rate plans in 2026: Free / Pro $15 / Business $200 / Premium $1000/month.
- The **Business plan ($200/month)** bundles CDN + WAF + DDoS + Route 53 DNS + TLS + serverless edge compute + CloudWatch Logs + S3 credits, with **no overage charges**, covering 125M requests and 50 TB data transfer.
- For a 50M-request election month this replaces ~$465 of pay-as-you-go edge costs (CloudFront + WAF + Route 53 + vended logs) with a single $200 flat fee — a **$265/month saving** that is the single biggest cost lever.

**Recomputed totals:**

| Metric | Before (v1) | After (v2, audited) | Reason |
|--------|-------------|----------------------|--------|
| Un-optimized monthly (peak) | $630.42 | **$703.14** | +Route 53, +Secrets Manager, +S3 requests, +CF rate correction (offset by WAF + Glue corrections) |
| Un-optimized annual | ~$1,709 | **~$1,517** | Lower idle baseline after Glue catalog correction |
| Optimized monthly (peak) | ~$367 | **~$402** | Optimization now uses CF Business plan instead of pay-as-you-go caching |
| Optimized annual | ~$1,445 | **~$816** | CloudFront Business plan + Parameter Store swap |
| Savings vs EC2 (annual, optimized) | ~83% | **~90%** | Business plan makes the election-month burst effectively flat-rate |

**Other edits:**
- Added a "Verification status" disclaimer (#9) listing which prices were ✅ verified from AWS pricing pages vs ⚠️ knowledge-based (not directly fetched from the Bulk Pricing API due to file size / tool truncation). The Bulk Pricing API JSON files for ap-southeast-1 are 10-200 MB each and exceeded the subagent's context budget — the verification was done against the public AWS pricing pages directly (CloudFront, WAF) and via documented ap-southeast-1 public pricing knowledge for the rest.
- Added Route 53 and Secrets Manager to the References table.
- Updated all Mermaid visualizations (pie + xychart) to use the new per-service totals.
- Updated the Cost Comparison section with new annual figures and added a note about the CloudFront Business plan being included in the Optimized column.

### Why

- The user requested a double-check of the costing for any missed items and updated AWS prices.
- The audit caught two material price errors (WAF +30% too high, CloudFront -20% too low for ap-southeast-1), two missing services (DNS and secrets management), and the Glue Catalog free-tier correction.
- Surfacing the new CloudFront Business flat-rate plan transformed the optimization story: instead of marginal caching savings on a $465 pay-as-you-go edge bill, the platform can move the entire edge layer to a single $200/month flat fee with no overage charges — turning the unpredictable election-month burst into a predictable fixed cost.
- Honest verification status was added because the AWS Bulk Pricing API files were too large for the agent's tool budget; only the CloudFront and WAF public pricing pages were directly fetched and verified, while the remaining per-service rates are based on commonly-published ap-southeast-1 public pricing knowledge.

---

## 2026-07-03 — Added cost-arch-v1.md and rewrote README Cost Comparison section

**Files changed:** `cost-arch-v1.md` (new), `README.md`
**Author:** Team Leader (Claude)
**Summary:** Created comprehensive cost-estimate document for the serverless architecture in ap-southeast-1 and rewrote the README Cost Comparison section to summarize it with a link to the full document.

### What changed
- **Created `cost-arch-v1.md`** — comprehensive monthly cost estimate covering:
  - 50M peak requests over a 2-day election window
  - ap-southeast-1 (Singapore) AWS region — nearest to the Philippines
  - Per-service breakdown with formulas for CloudFront, WAF, API Gateway (HTTP API), Lambda (×3), AWS Glue, Aurora Serverless v2, DynamoDB, S3, SNS, SQS, CloudWatch, X-Ray, and Athena
  - Peak vs idle vs always-on monthly cost split
  - Monthly total (un-optimized): ~$630.42 / month
  - Optimized total (with caching + bundle optimization): ~$367 / month
  - Annual projection: ~$1,710 (un-optimized) / ~$1,445 (optimized) vs ~$8,750 for the initial EC2 proposal
  - Optimization recommendations (11 items) ranked by impact
  - Mermaid visualization: pie charts, xychart for per-service and annual comparisons
  - References to AWS pricing pages for each service
- **Updated `README.md` → Cost Comparison section**:
  - Replaced the rough high-level comparison table with a more detailed overview
  - Added a callout block linking to `cost-arch-v1.md` for full details
  - Added an architecture-level cost table with revised monthly estimates
  - Added a comprehensive monthly estimate summary table categorized by cost area
  - Added annual projection table comparing initial EC2 vs un-optimized vs optimized serverless
  - Added "Key Insights" callouts highlighting the dominant data-transfer cost and idle cost
  - Noted that the initial EC2 baseline omitted peak data-transfer costs
- **Updated `README.md` → Table of Contents**:
  - Added entry for "Change Log" pointing to this file
- **Appended Change Log section** to the bottom of `README.md` linking to this file

### Why
- The original README Cost Comparison table was a rough planning figure (~$220 peak) that did not reflect realistic cloud spend for a 50M-request election-month workload
- The eigen-cost dominant (CloudFront data transfer) needed explicit treatment so that cost optimization (frontend bundle size, caching) could be quantified
- Singapore pricing differs from US pricing by ~10–20%, requiring region-specific calculation
- The user requested a comprehensive estimate with the assumption of 50M requests, 2 peak days, mostly idle for the rest of the month

---

## 2026-07-03 — Converted Architecture and Glue Pipeline diagrams to Mermaid UML

**Files changed:** `README.md`
**Author:** Team Leader (Claude)
**Summary:** Replaced ASCII art for the architecture diagram, AWS Glue ETL pipeline stages, and checksum validation flow with proper Mermaid UML flowcharts.

### What changed
- **Architecture Diagram** — converted ASCII box art to `graph TB` Mermaid flowchart with color-coded nodes by layer (clients=blue, edge=orange, compute=green, storage=purple, ETL=red, observability=gray dashed)
- **AWS Glue ETL Pipeline → Pipeline Stages** — converted linear ASCII flow to `graph TD` Mermaid flowchart with 5 numbered stages, decision nodes for PERSIST branches and reconciliation match/mismatch, and cylinder shapes for databases
- **Data Accuracy & Integrity → Checksum Validation** — converted ASCII flow to `graph TD` Mermaid flowchart with a valid/invalid decision node, red rejection path, and green acceptance path

### Why
- Mermaid UML renders natively on GitHub, GitLab, Bitbucket, and VS Code (with extension), giving proper visualization that the previous ASCII art couldn't provide
- Color coding and node shapes make the architecture easier to read at a glance
- Mermaid is version-controllable as text, unlike embedded images

---

## 2026-07-03 — Reframed Problem Statement from "Legacy" to "Initial Proposal"

**Files changed:** `README.md`
**Author:** Team Leader (Claude)
**Summary:** Reframed the Problem Statement section to reflect that the EC2-based design is a greenfield first proposal, not a deployed legacy system being migrated.

### What changed
- Problem Statement intro — changed "The legacy architecture runs..." to "PPCRV is a greenfield project with no existing deployed system. An initial architecture proposal used..."
- "Legacy Architecture" subsection renamed to "Initial Proposal (EC2-Based)"
- Table columns renamed: "Legacy Setup" / "Issue" → "Initial Proposal" / "Drawback"
- "Legacy cost" → "Estimated cost"
- Added new "Why Serverless Instead" subsection explaining why serverless fits the bursty election workload
- Component Breakdown table — "Replaces" column header → "Initial Proposal"
- Glue section text — "replaces the legacy c5.xlarge ETL server" → "replaces the initial proposal's c5.xlarge ETL server"
- Cost Comparison table — "Old Architecture" / "New Architecture" → "Initial Proposal (EC2)" / "Serverless Proposal"

### Why
- The user clarified that the EC2-based design is a first proposal, not a deployed legacy system
- The original "legacy migration" framing misrepresented the project's nature as a greenfield effort
- Updated language consistently across all references to maintain coherence

---

## 2026-07-03 — Converted Request Flows to UML sequence diagrams

**Files changed:** `README.md`
**Author:** Team Leader (Claude)
**Summary:** Replaced ASCII request-flow arrows with Mermaid `sequenceDiagram` blocks, and added a fifth flow for automated reconciliation.

### What changed
- Flow 1 — Load Website: `sequenceDiagram` with CloudFront cache hit/miss branching
- Flow 2 — Validate Vote: `sequenceDiagram` with valid/invalid data branching and Aurora insert path
- Flow 3 — Query Vote Metrics: `sequenceDiagram` with DynamoDB single-item lookup
- Flow 4 — Upload Precinct CSV: `sequenceDiagram` with the full 4-stage Glue pipeline (INGEST, DEDUPLICATE, TRANSFORM, PERSIST) and success/failure SNS branching
- Flow 5 — Reconciliation (new): `sequenceDiagram` showing CloudWatch scheduled trigger, Athena comparing raw S3 vs DynamoDB, with match/mismatch branching

### Why
- ASCII arrows are difficult to follow at a glance
- UML sequence diagrams are the standard way to express request flows and make the conditional branches (cache hit/miss, valid/invalid, success/failure) explicit
- Adding Flow 5 documented the automated reconciliation job that the Data Accuracy section refers to

---

## 2026-07-03 — Initial README.md created

**Files changed:** `README.md` (new)
**Author:** Team Leader (Claude)
**Summary:** Created the initial project README documenting PPCRV, the proposed serverless architecture with AWS Glue ETL pipeline, data storage strategy, accuracy safeguards, and request flows.

### What changed
- Initial `README.md` created with sections:
  - Project Overview (PPCRV definition, four core functions, CSV input format)
  - Problem Statement (later reframed as Initial Proposal)
  - Proposed Serverless Architecture (ASCII diagram, component breakdown table)
  - AWS Glue ETL Pipeline (5-stage pipeline, Glue vs Lambda comparison, Glue job config)
  - Data Storage Strategy (dual-store: S3 Parquet + DynamoDB aggregated, Aurora v2 for validation)
  - Data Accuracy & Integrity (6 measures: checksum validation, idempotent Glue, atomic updates, reconciliation, public transparency, audit trail)
  - Request Flows (4 flows, later expanded to 5)
  - Cost Comparison (later rewritten)
  - Open Action Items (10 TODOs)
  - Tech Stack Summary

### Why
- The user requested a project explanation and proposed architecture plan as a `README.md`
- Based on the "PPCRV Revamp Draft.xlsx" Excel document and the user's serverless-Glue preference
- Architecture decisions validated through iterative Q&A: large data volume (32M rows), Aurora Serverless choice, aggregated-metrics storage approach with accuracy safeguards