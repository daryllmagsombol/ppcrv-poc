# PPCRV Re-Architecture v3 — Cost Estimate (Delta)

A cost estimate for the **v3 cloud-agnostic architecture** described in [README.md](../README.md). This is a **delta document** — it only covers what changes from the v2 cost model in [cost-re-arch-v2.md](cost-re-arch-v2.md).

> [!IMPORTANT]
> All prices are in **USD** based on AWS public pricing for **ap-southeast-1** as of **July 2026**. Actual billing will vary. This is a planning estimate, not a quote.

---

## Table of Contents

- [What Changed in the Cost Model](#what-changed-in-the-cost-model)
- [Removed Services (Savings)](#removed-services-savings)
- [Added Services (New Costs)](#added-services-new-costs)
- [Changed Services (Cost Delta)](#changed-services-cost-delta)
- [Peak Month Breakdown](#peak-month-breakdown)
- [Idle Month Breakdown](#idle-month-breakdown)
- [Annual Projection](#annual-projection)
- [Auto-Shutdown Strategies](#auto-shutdown-strategies)
- [Dev Environment Impact](#dev-environment-impact)
- [Comparison: v1 vs v2 vs v3](#comparison-v1-vs-v2-vs-v3)
- [Per-Cloud Cost Notes](#per-cloud-cost-notes)
- [Notes & Disclaimers](#notes--disclaimers)

---

## What Changed in the Cost Model

| | v2 (Fargate + DDB + Aurora + Step Functions) | v3 (Fargate + Redis + Aurora SQL) |
|-|-----------------------------------------------|-------------------------------------|
| Fast KV | DynamoDB (Metrics + Status tables) | **Redis** (ElastiCache) — replaces 2 DynamoDB tables |
| ETL Orchestration | Step Functions + Lambda Trigger | **Redis job queue** (LPUSH/BRPOP) + Lambda Trigger |
| Real-time messaging | SNS pub/sub | **Redis pub/sub** (with SNS for durable alerts only) |
| Relational DB | Aurora Serverless v2 (with Aurora-specific features) | **Aurora Serverless v2** (standard SQL only — but same cost as v2) |
| Abstraction interfaces | 4 interfaces | 2 interfaces (less code, same infra cost) |

The only cost line items that change are **database** (DynamoDB → Redis) and **orchestration** (Step Functions → Redis queue, already paid for). SNS costs drop (real-time path moves to Redis). All other services carry over identically from [cost-re-arch-v2.md](cost-re-arch-v2.md).

---

## Removed Services (Savings)

These services are **removed** from the v3 architecture:

| Service | v2 Peak Cost | v2 Idle Cost | Note |
|---------|-------------|-------------|------|
| DynamoDB (VoteMetrics + PrecinctStatus tables) | $22.00 | $1.43 | Replaced by Redis |
| Step Functions | $0.06 | $0 | Replaced by Redis LPUSH/BRPOP |
| SNS (real-time events) | ~$1.00 | ~$0.50 | Moved to Redis pub/sub; SNS remains for durable alerts only |
| **Total savings** | **~$23.06** | **~$1.93** | |

---

## Added Services (New Costs)

These services are **new** in v3:

| Service | v3 Peak Cost | v3 Idle Cost | Calculation |
|---------|-------------|-------------|-------------|
| **Redis (ElastiCache)** | ~$25 | ~$25 | `cache.t3.small` (1.37 GB, single node) × 730h × ~$0.034/h |
| **Redis Rebuild Script** | $0 (included in ETL container) | ~$0.50/run | Athena query cost for rebuild (~5 min of query time) |
| **Total added** | **~$25** | **~$25.50** | |

### Detailed Redis Calculation

| Parameter | Value |
|-----------|-------|
| Instance type | `cache.t3.small` (1 vCPU, 1.37 GB) |
| Node count | 1 (single node, no cluster mode) |
| Hourly rate (ap-southeast-1) | ~$0.034/h |
| Monthly (always-on, 730h) | **~$24.82** |
| Monthly (auto-shutdown, idle months) | **$0** compute + ~$0.50 storage (see [Auto-Shutdown Strategies](#auto-shutdown-strategies)) |
| Monthly (dev, 168h/month) | ~$5.71 (8h/day × 21 weekdays) |

> [!NOTE]
> Redis is the **new dominant idle cost** in v3 if kept always-on ($25/month). With auto-shutdown, idle months drop to $0 compute. The trade-off: Redis handles three workloads (metrics, queue, pub/sub) where v2 needed three separate services (DynamoDB ×2 + Step Functions).

---

## Changed Services (Cost Delta)

### SNS/SQS — Reduced

| | v2 | v3 | Delta |
|-|----|----|-------|
| SNS (peak) | $2.00 | **$1.00** | -$1.00 |
| SNS (idle) | $0.50 | **$0.25** | -$0.25 |

Real-time pub/sub moved to Redis. SNS/SQS now used only for durable dead letter queue and operator alerts — half the message volume.

### Aurora Serverless v2 — Unchanged Cost, Different Usage

Cost is identical to v2. The change is operational: v3 commits to using only standard Postgres SQL (`psycopg2`), no Aurora Data API or Aurora-specific features. This doesn't affect cost — it affects portability.

---

## Peak Month Breakdown

### v3 Peak Month (Optimized — CloudFront Business Plan)

| Category | Components | Monthly Cost (USD) |
|----------|-----------|---------------------|
| Edge (Business plan) | CloudFront + WAF + Route 53 | $200.00 |
| API Layer | ALB | $21.00 |
| Compute (API) | Fargate API container (1 vCPU / 2 GB base + burst) | $43.00 |
| Compute (ETL) | Fargate ETL (500 tasks × ~2 min × 1 vCPU / 4 GB) | $1.00 |
| Fast KV + Queue + Pub/Sub | Redis (`cache.t3.small`) | $25.00 |
| Relational DB | Aurora Serverless v2 (0.5 ACU base + burst) | $11.00 |
| Storage + ECR | S3 + ECR | $6.00 |
| Durable Messaging | SNS + SQS (reduced) | $1.00 |
| Observability | CloudWatch + X-Ray | $35.00 |
| Analytics | Athena | $2.00 |
| AWS Lambda | S3 trigger (500 invocations, well within 1M/month free tier) | $0 |
| **TOTAL (Optimized Peak)** | | **~$345** |

### Peak Month Comparison (v1 → v2 → v3)

| Category | v1 (Lambda + Glue) | v2 (Fargate + DDB) | v3 (Fargate + Redis) |
|----------|---------------------|---------------------|----------------------|
| Edge (CF Business + ALB/API GW) | $254 | $225 | $221 |
| Compute | $46 | $45 | $44 |
| Database | $75 | $75 | **$36** (Redis $25 + Aurora $11) |
| Storage + Registry | $5 | $6 | $6 |
| Messaging | $2 | $2 | $1 |
| Observability | $35 | $35 | $35 |
| Analytics | $2 | $2 | $2 |
| **Peak Month Total** | **~$402** | **~$390** | **~$345** |

v3 is **$45-57/month cheaper at peak** than v1/v2, driven by Redis replacing DynamoDB + Step Functions.

---

## Idle Month Breakdown

### v3 Idle Month (Optimized — CloudFront Free Plan, WAF attached, Aurora auto-shutdown)

| Component | Idle Cost | Notes |
|-----------|----------|-------|
| CloudFront (Free plan, WAF attached) | $5.00 | WAF Web ACL only |
| ALB | $18.40 | Always-on base |
| Fargate API | $0 | Scales to 0 |
| Fargate ETL | $0 | No uploads |
| **Redis (always-on)** | **$24.82** | `cache.t3.small` — the idle-dominant cost |
| **Redis (auto-shutdown)** | **$0** | Stopped during idle, storage only (~$0.50/mo) |
| Aurora Serverless v2 | $7.92 | 0.5 ACU × 168h (auto-shutdown schedule, 8h/day × 21 weekdays) |
| S3 + ECR | $6.00 | Storage |
| SNS + SQS | $0.25 | Minimal |
| CloudWatch | $11.00 | Dashboards + alarms + log storage |
| Lambda Trigger | $0 | Free tier (500 invocations peak is well within 1M/month free tier) |
| Athena | $0.13 | Minimal |
| **Total (Aurora auto-shutdown, Redis always-on)** | **~$74** | |
| **Total (Redis auto-shutdown, Aurora auto-shutdown)** | **~$49** | See [Auto-Shutdown Strategies](#auto-shutdown-strategies) |

### Idle Month Comparison

| Scenario | v1 | v2 | v3 (Redis always-on) | v3 (Redis auto-shutdown) |
|----------|-----|-----|----------------------|--------------------------|
| Optimized idle (CF Free, WAF on) | ~$65 | ~$51 | **~$74** | **~$49** |

> [!NOTE]
> Redis always-on ($25/mo) makes v3 more expensive than v2 at idle. The auto-shutdown strategy brings v3 below v2. This is the cost of consolidating three services into Redis — you pay ~$25/mo for the convenience, or you write the rebuild script and save ~$26/mo.

---

## Annual Projection

For an election-cycle year (1 peak month + 11 idle months):

### Always-On Scenario (no auto-shutdown)

| Year | v1 | v2 | v3 |
|------|-----|-----|-----|
| 1 peak month | $402 | $390 | $345 |
| 11 idle months (always-on) | $65 × 11 = $715 | $51 × 11 = $561 | $74 × 11 = $814 |
| **Annual Total** | **$1,117** | **$951** | **$1,159** |

v3 is ~$208 more than v2 with Redis always-on. The Redis idle cost ($25/mo × 11 = $275) outweighs the peak savings ($45/month).

### Optimized with Auto-Shutdown (Recommended)

| Scenario | v1 | v2 | v3 |
|----------|-----|-----|-----|
| 1 peak month (Business plan) | $402 | $390 | $345 |
| 11 idle months (auto-shutdown DBs) | $65 × 11 = $715 | $51 × 11 = $561 | $48 × 11 = $528 |
| **Annual Total** | **$1,117** | **$951** | **$873** |

### Breakdown with Mixed Auto-Shutdown

| Scenario | Annual | Notes |
|----------|--------|-------|
| Aurora auto-shutdown + Redis always-on | ~$1,012 | No rebuild script needed |
| Aurora auto-shutdown + Redis auto-shutdown | **~$821** | Rebuild script required |
| Both always-on | ~$1,159 | Simplest, most expensive |
| Both auto-shutdown (full optimization) | **~$883** | Includes CF plan-switching + all DBs shut down during idle. Aurora: $7.92/mo idle, Redis: $0/mo idle |

**Math (full optimization — both auto-shutdown):**
- Peak: $345
- Idle: $42.69 × 11 = $469.59
  - CF Free + WAF: $5
  - ALB: $18.40
  - Aurora (auto-shutdown): $7.92
  - Redis (auto-shutdown): $0 (stopped, storage only ~$0.50)
  - Everything else: ~$11.37
- Total: $345 + $469.59 = **~$815**
- Add rebuild costs: $0.50 × 12 (monthly + election restart) = $6
- **Annual: ~$821**

> [!NOTE]
> **Counterintuitive finding:** With full auto-shutdown, v3 is **~$130/year cheaper than v2** ($821 vs $951). The Redis rebuild script is the price: ~$130/year savings for an extra ~100 lines of code. Without auto-shutdown, v3 is ~$208/year more expensive than v2 — the Redis always-on idle cost dominates.

---

## Auto-Shutdown Strategies

### Aurora Serverless v2 — Built-in

Aurora Serverless v2 auto-scales to 0.5 ACU. No stop/restart needed — it's always available at minimum capacity. During idle months, EventBridge Scheduler limits it to 8h/weekday → 0.5 ACU × 168h/month = ~$8/month.

### Redis — Manual Stop/Restart + Rebuild

Redis doesn't auto-scale to near-zero. Two strategies:

#### Strategy A: Keep Always-On (Simple)

| | Cost |
|-|------|
| `cache.t3.small` × 730h/month | **~$25/month** |
| Annual idle cost (11 months) | **~$275** |

Pro: Zero operational complexity. Con: Most expensive option.

#### Strategy B: Auto-Shutdown + Rebuild (Recommended)

| Action | Cost |
|--------|------|
| Stop Redis during idle months | $0 compute, minimal storage |
| Restart before election + rebuild from S3 | ~$0.50/rebuild (Athena query) |
| Monthly idle cost (stopped) | **$0** (compute) |
| Annual rebuild cost (12 restarts) | **~$6** |

Pro: Saves **~$269/year** vs always-on. Con: Requires rebuild script, 5-minute cold start on restart.

> [!NOTE]
> During idle months, Redis is **completely stopped** — $0 compute cost. The 168h/month figure in the Aurora section is for Aurora's built-in auto-scaling (it can't scale to zero). Redis is manually stopped/started, so idle months have zero compute cost. The only ongoing cost is minimal storage for ElastiCache snapshots (~$0.50/month).

**Implementation:**
```
# EventBridge Scheduler (AWS) / Cloud Scheduler (GCP) / Azure Logic Apps:
# - Start of idle period: delete/stop Redis cluster
# - 1 hour before peak period: create/start Redis cluster
#   → Run rebuild script
#   → API container starts serving from fresh Redis
```

---

## Dev Environment Impact

### v3 Dev Monthly Breakdown

| Component | Cost | Notes |
|-----------|------|-------|
| CloudFront Free | $0 | Within free tier |
| WAF | $5 | Flat fee |
| Route 53 | $0.50 | Hosted zone |
| ALB | $18.40 | Always-on (same as v2) |
| Fargate API | $0 | Scales to 0 outside dev hours |
| Fargate ETL | $0.50 | Occasional test runs |
| Redis (`cache.t3.micro`, 0.5 GB) | $12.00 | Cheapest instance for dev |
| Aurora (auto-shutdown, 8h/day) | $8.00 | 0.5 ACU × 168h |
| ECR | $0.50 | Container image storage |
| S3 | $0.14 | Small test data |
| SNS + SQS | $0 | Free tier |
| CloudWatch | $6 | Dev logging |
| X-Ray | $0 | Free tier |
| Athena | $0.13 | Occasional test queries |
| **Total dev/month** | **~$51** | (vs ~$29 v1, ~$42 v2) |

v3 dev is more expensive than v1/v2 due to Redis always-on in dev ($12/mo for `cache.t3.micro`). In dev, you can skip Redis shutdown since you're actively developing.

---

## Comparison: v1 vs v2 vs v3

| Metric | v1 (Lambda + Glue) | v2 (Fargate + DDB) | v3 (Fargate + Redis) |
|--------|---------------------|---------------------|----------------------|
| **Peak month (Business plan)** | ~$402 | ~$390 | **~$345** |
| **Idle month (optimized, auto-shutdown)** | ~$65 | ~$51 | **~$48** |
| **Idle month (optimized, Redis always-on)** | — | — | ~$74 |
| **Annual (optimized, full auto-shutdown)** | ~$1,117 | ~$951 | **~$821** |
| **Annual (optimized, Aurora-only auto-shutdown)** | — | — | ~$1,012 |
| **Annual (always-on)** | ~$1,117 | ~$1,171 | ~$1,159 |
| **Dev environment / month** | ~$29 | ~$42 | ~$51 |
| **Services to migrate per cloud** | 10+ | ~8 | **~5** |
| **Abstraction interfaces needed** | 4 | 4 | **2** |
| **Cold start (API query)** | ~100-500ms (Lambda) | ~10-30s (Fargate) | ~10-30s (Fargate) |
| **Cold start (after Redis auto-shutdown)** | — | — | ~30 sec (with RDB) / ~5 min (without) |
| **Vote metrics read latency** | 5-10ms (DynamoDB) | 5-10ms (DynamoDB) | **<1ms (Redis)** |
| **Max ETL execution time** | 15 min (Lambda) | Unlimited (Fargate) | Unlimited (Fargate) |
| **Portable to GCP/Azure?** | ❌ | ✅ | ✅ (fewer services to reimplement) |
| **Redis HA (Multi-AZ)** | — | — | **~$50/mo** (optional, post-MVP) |

---

## Redis Multi-AZ & RDB Snapshots (Optional)

### Multi-AZ ElastiCache (Production HA)

| Configuration | Nodes | Monthly Cost | RTO |
|---------------|-------|--------------|-----|
| Single node (MVP) | 1 × `cache.t3.small` | ~$25 | ~5 min (rebuild from S3) |
| Multi-AZ (primary + replica) | 2 × `cache.t3.small` | **~$50** | ~30 sec (auto-failover) |

**Recommendation:** Single node for MVP. Upgrade to Multi-AZ after launch if Redis is a bottleneck. The ~5 min rebuild from S3 is acceptable for a greenfield project.

### RDB Snapshots (Reduce Rebuild Time)

| Strategy | Storage Cost | Restart Time | Rebuild Needed |
|----------|-------------|--------------|----------------|
| No RDB | $0 | ~5 min | Full Athena rebuild |
| RDB every 15 min | ~$0.50/mo (S3 storage) | ~30 sec | Only data changed since snapshot |
| RDB + AOF | ~$1/mo | ~10 sec | Near-zero data loss |

**Impact on annual cost:** +$6/year for RDB snapshots. Reduces "Redis restart → 5 min rebuild" to ~30 seconds.

---

## Per-Cloud Cost Notes

### AWS (ap-southeast-1)

| Service | Price |
|---------|-------|
| Redis `cache.t3.small` | ~$0.034/h |
| Aurora Serverless v2 (0.5 ACU) | ~$0.06/ACU-hour |
| Fargate | $0.04048/vCPU-h + $0.004445/GB-h |
| ALB | $0.0252/h base |

### GCP (asia-southeast1)

| Service | AWS Price | GCP Estimated |
|---------|-----------|---------------|
| Memorystore Redis (Basic, M1) | $25/mo | ~$35/mo |
| Cloud SQL Postgres (db-f1-micro, 1 vCPU / 0.6 GB) | — | ~$8/mo (minimum) |
| Cloud Run | — | ~$0/vCPU-s + ~$0/GB-s (similar to Fargate, pay-per-request) |

GCP Redis (Memorystore Basic) is ~$10/mo more expensive than AWS ElastiCache. Cloud SQL doesn't auto-scale to zero like Aurora — you pay for a minimum instance.

### Azure (Southeast Asia)

| Service | AWS Price | Azure Estimated |
|---------|-----------|-----------------|
| Azure Cache for Redis (Basic C0, 250 MB) | — | ~$16/mo (minimum) |
| Azure Cache for Redis (Basic C1, 1 GB) | — | ~$50/mo |
| Azure Database for PostgreSQL (Basic, 1 vCore) | — | ~$25/mo |

Azure Redis pricing is tiered. C0 (250 MB) might be too small for 32M rows of metrics; C1 (1 GB) is ~$50/mo — roughly double AWS's `cache.t3.small`.

> [!IMPORTANT]
> **GCP and Azure pricing is preliminary** — based on list prices (July 2026), not actual billing. These estimates need verification with cloud pricing calculators before making migration decisions. AWS tends to be cheapest for managed services in Southeast Asia. Key differences:
> - GCP Redis (Memorystore) has no `t3.micro` equivalent — minimum is M1 (~$35/mo)
> - Azure Redis C0 (250 MB) may be too small for 32M rows of metrics
> - Cloud SQL doesn't auto-scale to zero like Aurora — you pay for a minimum instance 24/7
> - Azure Postgres Basic tier is ~$25/mo minimum vs Aurora's ~$8/mo with auto-shutdown

---

## Notes & Disclaimers

1. **Delta document** — only changed services are costed. For unchanged services (CloudFront, ALB, Fargate compute, S3, CloudWatch, Athena), see [cost-re-arch-v2.md](cost-re-arch-v2.md) and [cost-arch-v1.md](cost-arch-v1.md).
2. **Redis pricing** — based on `cache.t3.small` on-demand pricing in ap-southeast-1. Reserved instances (1-year, all-upfront) reduce this by ~37% ($25 → ~$16/mo). Compute Savings Plans don't apply to ElastiCache.
3. **Redis auto-shutdown assumption** — AWS/ElastiCache supports stopping/starting clusters. Verify auto-shutdown automation with your cloud provider. On GCP/Azure, similar patterns exist (stop/start Redis instances on schedule).
4. **Rebuild cost** — Athena charges $5/TB scanned. 32M rows of Parquet at ~9 columns averages ~3-5 GB compressed → ~$0.015-0.025 per rebuild. The $0.50/run estimate is conservative.
5. **Aurora Serverless v2** — costs identical to v2. Only usage changes (standard SQL only, no Aurora-specific features). No cost delta.
6. **No Reserved Capacity assumed** — all prices are on-demand for planning purposes. Reserved instances (Redis, RDS, Fargate Savings Plans) can reduce annual cost further.
7. **Multi-AZ Redis** — adds ~$25/mo (2× node cost). Optional, recommended for production post-MVP. Single node + RDB snapshots is sufficient for MVP.
8. **RDB snapshots** — ~$0.50/mo for S3 storage of the snapshot file. Reduces restart time from ~5 min to ~30 sec. Recommended during election week.
9. **Per-cloud cost variance** — AWS tends to be cheapest for managed services in Southeast Asia. GCP and Azure may be 20-50% more expensive for equivalent Redis/Postgres instances. Migration cost includes this monthly premium in addition to the one-time migration effort.
10. **Athena/BigQuery/Synapse** — rebuild script uses cloud analytics to query S3 Parquet. Cost per rebuild is minimal (<$1). Migration between clouds means swapping the analytics client library, not rewriting the rebuild logic.

---

## References

| Service | AWS Pricing Page |
|---------|-----------------|
| ElastiCache Redis | https://aws.amazon.com/elasticache/pricing/ |
| Aurora Serverless v2 | https://aws.amazon.com/rds/aurora/pricing/ |
| Fargate | https://aws.amazon.com/fargate/pricing/ |
| ALB | https://aws.amazon.com/elasticloadbalancing/pricing/ |
| Athena | https://aws.amazon.com/athena/pricing/ |
| All unchanged services | See [cost-re-arch-v2.md](cost-re-arch-v2.md) and [cost-arch-v1.md](cost-arch-v1.md) |
