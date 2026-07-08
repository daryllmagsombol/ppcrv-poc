# PPCRV Re-Architecture — Cost Estimate (Delta)

A cost estimate for the **cloud-portable Fargate architecture** described in [readme-re-arch-v2.md](readme-re-arch-v2.md). This is a **delta document** — it only covers what changes from the original cost model in [cost-arch-v1.md](cost-arch-v1.md).

> [!IMPORTANT]
> All prices are in **USD** based on AWS public pricing for **ap-southeast-1** as of **July 2026**. Actual billing will vary. This is a planning estimate, not a quote.

---

## Table of Contents

- [What Changed in the Cost Model](#what-changed-in-the-cost-model)
- [Removed Services (Savings)](#removed-services-savings)
- [Added Services (New Costs)](#added-services-new-costs)
- [Net Monthly Impact](#net-monthly-impact)
- [Peak Month Breakdown](#peak-month-breakdown)
- [Idle Month Breakdown](#idle-month-breakdown)
- [Annual Projection](#annual-projection)
- [Dev Environment Impact](#dev-environment-impact)
- [Comparison: v1 vs v2](#comparison-v1-vs-v2)
- [ALB Decision: Always-on vs Destroy](#alb-decision-always-on-vs-destroy)
- [Notes & Disclaimers](#notes--disclaimers)

---

## What Changed in the Cost Model

| | v1 (Lambda + Glue) | v2 (Fargate Re-Architecture) |
|-|---------------------|---------------------|
| Compute (API) | Lambda × 2 + API Gateway | **Fargate API container + ALB** |
| Compute (ETL) | AWS Glue (Spark) | **Fargate ETL container + Step Functions** |
| Everything else | CloudFront, WAF, Route 53, Aurora, DynamoDB, S3, SNS, SQS, CloudWatch, X-Ray, Athena | **Unchanged** |

The only cost line items that change are **compute** and **API routing**. All other services (edge, database, storage, messaging, observability, analytics) carry over identically from [cost-arch-v1.md](cost-arch-v1.md).

---

## Removed Services (Savings)

These services are **removed** from the v2 architecture. Their costs disappear from the bill:

| Service | v1 Peak Cost | v1 Idle Cost | Note |
|---------|-------------|-------------|------|
| API Gateway (HTTP API) | $54.12 | $0.12 | Replaced by ALB |
| Lambda Vote Metrics | $28.95 | < $0.05 | Replaced by Fargate API container |
| Lambda Validation | $16.68 | < $0.05 | Replaced by Fargate API container |
| AWS Glue | $10.12 | $0.10 | Replaced by Fargate ETL container |
| **Total savings** | **$109.87** | **~$0.32** | |

> [!NOTE]
> The **Lambda S3 Trigger** is **not removed** — it still exists in v2 and triggers Step Functions (instead of Glue directly). Its cost ($1.00 peak, $0 idle) is unchanged and carried over from v1.

---

## Added Services (New Costs)

These services are **new** in v2:

| Service | v2 Peak Cost | v2 Idle Cost | Calculation |
|---------|-------------|-------------|-------------|
| **Fargate API** | ~$43 | $0 (scales to 0) | Base 1 vCPU + 2 GB × 730h + burst 3 containers × 48h |
| **Fargate ETL** | ~$2 | $0 | 500 tasks × ~2 min × 1 vCPU + 4 GB |
| **ALB** | ~$25 | ~$18 | Base $0.0252/h × 730h + LCU during 2-day burst |
| **Step Functions** | ~$0.06 | $0 | 500 executions × Standard × $0.025 per 1K transitions |
| **ECR** | ~$1 | ~$1 | Container image storage |
| **Total added** | **~$71** | **~$19** | |

### Detailed Fargate API Calculation

| Parameter | Peak (2-day burst) | Idle |
|-----------|-------------------|------|
| Base container (1 vCPU / 2 GB) | 1 × 730h = 730h | Scales to 0 tasks |
| Burst containers (48h × 3 extra) | 144h | — |
| Total Fargate hours | 874h | 0h |
| Compute rate (ap-southeast-1) | $0.04048/vCPU-h + $0.004445/GB-h | |
| Compute cost | 874 × $0.04048 + 874 × 2 × $0.004445 ≈ **$43.46** | $0 |

> [!NOTE]
> Fargate can scale to **0 tasks** when idle (set minimum = 0 in auto-scaling config). No compute charge during idle periods. The ALB remains running (it's the trade-off for portability — see [ALB Decision](#alb-decision-always-on-vs-destroy)).

### Detailed Fargate ETL Calculation

| Parameter | Peak (election month) | Idle |
|-----------|----------------------|------|
| Tasks triggered | 500 (one per CSV upload) | 0 |
| Task duration | ~2 min (0.033h) average | — |
| Task size | 1 vCPU + 4 GB | — |
| Total Fargate-hours | 500 × 0.033 = 16.6h | 0 |
| Compute rate (ap-southeast-1) | $0.04048/vCPU-h + $0.004445/GB-h | |
| Compute cost | 16.6 × $0.04048 + 16.6 × 4 × $0.004445 ≈ **$0.97** | $0 |
| Step Functions | 500 executions × 3 transitions × $0.025/1K = $0.013 | $0 |
| Round-up (buffer for Lambda trigger + Step Functions) | ~$1 | $0 |
| **Total ETL** | **~$2** | **$0** |

### Detailed ALB Calculation

| Parameter | Peak (2-day burst) | Idle |
|-----------|-------------------|------|
| Base hours | 730h (always-on) | 730h |
| Base cost | $0.0252/h × 730 = **$18.40** | **$18.40** |
| LCU (Load Balancer Capacity Units) | ~5 LCU × 48h × $0.008 = ~$2 | ~0.3 LCU × 730h × $0.008 = ~$2 |
| Processed bytes | Included in LCU | Included |
| **Total ALB** | **~$21–25** | **~$18.40** |

> [!IMPORTANT]
> The ALB is the **largest single overhead** in the v2 idle cost. This is the trade-off for replacing Lambda (which scales to $0) with Fargate containers (which need a persistent load balancer). See [ALB Decision](#alb-decision-always-on-vs-destroy) for alternatives.

---

## Net Monthly Impact

### Peak Month

| | v1 (Lambda + Glue) | v2 (Fargate Re-Architecture) | Delta |
|-|---------------------|---------------------|-------|
| Compute + API layer | $110.87 | ~$72 (includes unchanged Lambda S3 Trigger) | **-$38.87** |
| All other services | $592.27 | $592.27 | 0 |
| **Total peak month** | **~$703** | **~$665** | **-$38** (~5% savings) |

### Idle Month (Un-Optimized — PAYG CloudFront, Aurora always-on)

| | v1 | v2 | Delta |
|-|----|----|-------|
| Compute + API layer | ~$0.32 | ~$19 (ALB) | **+$18.68** |
| All other services | ~$73.92 | ~$73.92 | 0 |
| **Total idle month** | **~$74** | **~$93** | **+$19** (~25% increase) |

> See [Idle Month Breakdown](#idle-month-breakdown) for the optimized scenario (CloudFront Free plan + Aurora auto-shutdown) where v2 drops to ~$51/month.

---

## Peak Month Breakdown

### v2 Peak Month (PAYG, Un-Optimized)

| Category | Components | Monthly Cost (USD) |
|----------|-----------|---------------------|
| **Edge & Networking** | CloudFront + WAF + Route 53 | $458.90 |
| **API Layer** | ALB | $25.00 |
| **Compute (API)** | Fargate API container | $43.00 |
| **Compute (ETL)** | Fargate ETL + Step Functions + Lambda S3 Trigger | $3.06 |
| **Database** | Aurora Serverless v2 + DynamoDB | $74.84 |
| **Storage** | S3 + ECR | $6.29 |
| **Messaging** | SNS + SQS | $2.00 |
| **Observability** | CloudWatch + X-Ray | $41.50 |
| **Analytics** | Athena | $1.60 |
| **TOTAL (Un-Optimized)** | | **~$666** |

### v2 Peak Month (Optimized — CloudFront Business Plan)

| Category | Monthly Cost (USD) |
|----------|---------------------|
| Edge (Business plan absorbs CF + WAF + R53 + logs) | $200 |
| API Layer (ALB) | $25 |
| Compute (Fargate API + Lambda S3 Trigger) | $44 |
| Compute (Fargate ETL + Step Functions) | $2 |
| Database | $75 |
| Storage + ECR | $6 |
| Messaging | $2 |
| Observability | $35 |
| Analytics | $2 |
| **TOTAL (Optimized Peak)** | **~$391** |

---

## Idle Month Breakdown

### v2 Idle Month (Optimized — CloudFront Free plan, WAF attached)

| Component | Idle Cost | Notes |
|-----------|----------|-------|
| CloudFront (Free plan, WAF attached) | $5 | WAF Web ACL only ($5), CF Free = $0 |
| ALB | $18.40 | Always-on base cost — the main portability overhead |
| Fargate API | $0 | Scales to 0 tasks |
| Fargate ETL | $0 | No uploads during idle |
| Lambda S3 Trigger | $0 | No uploads during idle |
| Route 53 | $0.50 | Hosted zone |
| API Gateway | $0 | Removed |
| AWS Glue | $0 | Removed |
| Aurora Serverless v2 | $26.88 | 0.5 ACU × 672h (if always-on) or $7.92 (with auto-shutdown) |
| DynamoDB | $1.43 | Storage only |
| S3 + ECR | $6 | Storage |
| SNS + SQS | $0.50 | Minimal |
| CloudWatch | $11 | Dashboards + alarms + storage |
| X-Ray | $0 | Free tier |
| Athena | $0.13 | Minimal |
| Secrets Manager | $0 | Use SSM Parameter Store (free) |
| **Total (Aurora always-on)** | **~$71** | $6 more than v1 optimized idle (~$65) |
| **Total (Aurora auto-shutdown)** | **~$51** | $14 less than v1 optimized idle (~$65) |

> [!NOTE]
> **Un-optimized idle** (pay-as-you-go CloudFront, no plan-switching) adds ~$18 for the ALB on top of the v1 un-optimized idle (~$74), for a total of ~$92/month. The ALB is the significant cost addition in the v2 idle scenario regardless of optimization.

---

## Annual Projection

For an election-cycle year (1 peak + 11 idle):

| Scenario | v1 Annual | v2 Annual | Delta |
|----------|----------|----------|-------|
| Un-Optimized (PAYG all year, Aurora always-on) | ~$1,517 | ~$1,676 | +$159 (v2 more expensive) |
| Optimized (Business plan, WAF attached, Aurora auto-shutdown) | ~$1,117 | **~$951** | **-$166** (v2 cheaper) |
| Optimized (Business plan, WAF attached, Aurora always-on) | ~$1,117 | ~$1,171 | +$54 (v2 more expensive) |

**Math:**
- Un-Optimized: v1 = $703 + 11 × $74 = $1,517. v2 = $665 + 11 × $92 = $1,677.
- Optimized (auto-shutdown): v1 = $402 + 11 × $65 = $1,117. v2 = $391 + 11 × $51 = $952.
- Optimized (Aurora always-on): v1 = $402 + 11 × $65 = $1,117. v2 = $391 + 11 × $71 = $1,172.

> [!NOTE]
> **Counterintuitive finding:** With Aurora auto-shutdown in idle months, v2 is actually **~$165/year cheaper** than v1. The ALB always-on cost (~$202/year across 11 idle months) is completely offset by peak-month savings: removing API Gateway ($54) + Lambda ($46) + Glue ($10) = $110 cheaper per peak month, plus Aurora auto-shutdown saves another $19/mo on the 11 idle months.
>
> If you keep Aurora always-on in v2 (no auto-shutdown), the annual cost is ~$55/year more than v1 — a negligible premium for portability.
>
> **Bottom line:** the v2 (Fargate) architecture is essentially cost-neutral or potentially cheaper than v1 (Lambda), assuming you use Aurora auto-shutdown. The "portability premium" story is more about operational trade-offs (slower cold starts, ALB always-on) than annual AWS bill.

---

## Dev Environment Impact

The dev cost estimate in [COSTS-DEV.md](COSTS-DEV.md) applies to the v2 architecture with these deltas:

### Dev Cost Delta

| Component | v1 Dev Cost | v2 Dev Cost | Delta |
|-----------|------------|------------|-------|
| Lambda (×3) | $0 (free tier) | $0 (Fargate scales to 0) | 0 |
| API Gateway | $0 (free tier) | **$18** (ALB base) | **+$18** |
| Glue | $5.51 | $0.50 (Fargate ETL, dev test runs) | -$5.01 |
| ECR | $0 | $0.50 (container image storage) | +$0.50 |
| Everything else | ~$23.50 | ~$23.50 | 0 |
| **Total dev/month** | **~$29** | **~$42** | **+$13** |

### v2 Dev Monthly Breakdown

| Component | Cost | Notes |
|-----------|------|-------|
| CloudFront Free | $0 | Within free tier |
| WAF | $5 | Flat fee |
| Route 53 | $0.50 | Hosted zone |
| **ALB** | **$18** | Always-on even in dev |
| Fargate API | $0 | Scales to 0 outside dev hours |
| Fargate ETL | $0.50 | Occasional test runs |
| Step Functions | $0 | Negligible |
| ECR | $0.50 | Container image storage |
| Aurora (auto-shutdown) | $8 | 0.5 ACU × dev hours only |
| DynamoDB | $0.60 | Minimal test data |
| S3 | $0.14 | Small test data |
| SNS + SQS | $0 | Free tier |
| CloudWatch | $6 | Dev logging |
| X-Ray | $0 | Free tier |
| Athena | $0.13 | Occasional test queries |
| **Total dev/month** | **~$40–42** | (vs ~$29 in v1) |

ALB is the dominant cost in the dev environment for the v2 architecture — it's $18/month regardless of usage, even when all Fargate tasks are scaled to zero.

---

## Comparison: v1 vs v2

| Metric | v1 (Lambda + Glue) | v2 (Fargate Re-Architecture) |
|--------|---------------------|---------------------|
| **Peak month (PAYG)** | ~$703 | ~$665 |
| **Peak month (Business plan)** | ~$402 | ~$391 |
| **Idle month (un-optimized)** | ~$74 | ~$93 |
| **Idle month (optimized, Aurora auto-shutdown)** | ~$65 | ~$51 |
| **Annual (optimized, WAF attached, Aurora auto-shutdown)** | ~$1,117 | ~$952 |
| **Annual (optimized, WAF attached, Aurora always-on)** | ~$1,117 | ~$1,172 |
| **Dev environment / month** | ~$29 | ~$42 |
| **Portable to GCP/Azure?** | ❌ No (Lambda + Glue are AWS-only) | ✅ Yes (Docker image runs on any cloud) |
| **Cold start** | ~100-500ms (Lambda) | ~10-30s (Fargate container start) |
| **Max execution time** | 15 min (Lambda) | Unlimited (Fargate) |
| **Cost premium for portability** | — | **-$165/year** (auto-shutdown) or **~$55/year** (Aurora always-on) |

---

## ALB Decision: Always-on vs Destroy

The ALB is the **only significant cost difference** between v1 and v2 during idle months. Three strategies:

| Strategy | Annual Idle Cost | Pros | Cons |
|----------|-----------------|------|------|
| **Keep ALB alive** (recommended) | ~$202 (11 × ~$18.40) | Same URL always works, no infra changes between election cycles, ready for unexpected traffic | Always paying for idle infra |
| **Destroy ALB during idle** | $0 | Maximum savings | Terraform/IaC destroy + recreate → adds 5-10 min startup time when needed, more complex ops, DNS may need updating |
| **Switch to NLB** (L4 only) | ~$120 (11 × ~$11) | Cheaper than ALB, still always-on | No L7 path-based routing, no host-header routing, TLS termination at CloudFront |

### Recommendation

**Keep the ALB alive.** The ~$202/year cost is the **price of portability** — it's the only "always-on" infrastructure in an otherwise scale-to-zero architecture. Destroying it adds operational complexity and startup latency for an election platform where reliability matters more than ~$202/year.

---

## Notes & Disclaimers

1. **Delta document** — only changed services are costed. For unchanged services (CloudFront, Aurora, DynamoDB, S3, CloudWatch, etc.), see [cost-arch-v1.md](cost-arch-v1.md).
2. **Fargate pricing** — based on ap-southeast-1 on-demand rates. Fargate Spot (if available for your task type) could reduce ETL costs by ~50%.
3. **ALB LCU calculation** — the peak LCU estimate assumes ~5 LCU during the 2-day burst. Actual LCU depends on processed bytes, new connections, and rule evaluations. Verify with AWS Pricing Calculator.
4. **Step Functions pricing** — Standard Workflows at $0.025 per 1,000 state transitions. Assumes ~3 transitions per ETL task (start → run → success). Express Workflows ($1.00/M transitions) would be cheaper for very high volume.
5. **ECR cost** — assumes 2–3 container images (API + ETL + possibly a shared base) totaling ~10 GB at $0.10/GB-month.
6. **No Reserved Capacity assumed** — Fargate on-demand rates used throughout. Compute Savings Plans could reduce Fargate costs by ~30-50% for committed usage.
7. **Idle Fargate scaling** — requires auto-scaling minimum = 0. The ALB health check will fail until the first task starts (10-30s), which CloudFront will handle as a 502 until the container is healthy. For production, consider keeping min=1 during election day.
8. **Aurora auto-shutdown assumption** — uses EventBridge Scheduler as described in [COSTS-DEV.md](COSTS-DEV.md). Same approach applies to the v2 architecture.

---

## References

| Service | AWS Pricing Page |
|---------|-----------------|
| Fargate | https://aws.amazon.com/fargate/pricing/ |
| ALB | https://aws.amazon.com/elasticloadbalancing/pricing/ |
| Step Functions | https://aws.amazon.com/step-functions/pricing/ |
| ECR | https://aws.amazon.com/ecr/pricing/ |
| All unchanged services | See [cost-arch-v1.md#references](cost-arch-v1.md#references) |