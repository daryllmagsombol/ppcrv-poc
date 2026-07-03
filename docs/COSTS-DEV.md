# PPCRV — Development Environment Cost Estimate

A monthly cost estimate for the shared **dev** AWS environment in **ap-southeast-1 (Singapore)** — a scaled-down version of the production stack for 3 developers to build and test end-to-end flows.

> [!IMPORTANT]
> All prices are in **USD** based on AWS public pricing for **ap-southeast-1** as of **July 2026**. Actual billing will vary. This is a planning estimate, not a quote.

---

## Table of Contents

- [Assumptions & Schedule](#assumptions--schedule)
- [Auto-Shutdown Strategy](#auto-shutdown-strategy)
- [Per-Service Cost Breakdown](#per-service-cost-breakdown)
  - [Edge & Networking](#edge--networking)
  - [Compute](#compute)
  - [Database](#database)
  - [Storage](#storage)
  - [Messaging & Queues](#messaging--queues)
  - [Observability](#observability)
  - [Ad-Hoc Analytics](#ad-hoc-analytics)
- [Monthly Summary](#monthly-summary)
- [Annual Projection](#annual-projection)
- [Comparison with Production](#comparison-with-production)
- [Notes & Disclaimers](#notes--disclaimers)

---

## Assumptions & Schedule

### Team

| Parameter | Value |
|-----------|-------|
| Developers | 3 |
| Timezone | PHT / UTC+8 (same) |
| Working days | Monday – Friday |
| Working hours | 8:00 AM – 6:00 PM (10-hour window) |
| Active AWS hours | ~9 hours/day (buffer for extended sessions) |
| Active days/month | ~22 |

### Dev Traffic Profile (per month)

| Metric | Dev | Prod (Peak) | Scaling Factor |
|--------|-----|-------------|----------------|
| API requests | ~100,000 | 45,000,000 | ~0.2% |
| Lambda invocations | ~200,000 | 45,500,000 | ~0.4% |
| Glue runs | ~22 | ~500 | ~4% |
| Data transfer | < 5 GB | 2.6 TB | ~0.2% |
| Test data size | ~5 GB | 121 GB | ~4% |
| DNS queries | ~50,000 | 50,000,000 | ~0.1% |

### What's NOT Included

- CI/CD runner costs (GitHub Actions free tier)
- Terraform state resources (~$0.11/mo, already accounted in [TERRAFORM.md](./TERRAFORM.md))
- Developer workstations / local tooling
- Any third-party monitoring or APM tools

---

## Auto-Shutdown Strategy

The single biggest cost optimization for the dev environment is **turning off Aurora Serverless v2 when nobody is using it**. Aurora v2 has a minimum billable of 0.5 ACU — it can't scale to zero, so every hour it's running costs ~$0.04.

### Schedule

| Period | Aurora State | Hours/Month | Cost |
|--------|-------------|-------------|------|
| Weekdays 8 AM – 7 PM | **Running** | 9h × 22 days = 198h | ~$7.92 |
| Weekdays 7 PM – 8 AM | **Scheduled pause** | — | $0 |
| Weekends (Fri 7PM – Mon 8AM) | **Scheduled pause** | — | $0 |

### Implementation

Use **Amazon EventBridge Scheduler** with two cron rules:

```cron
# Start: Weekdays at 7:45 AM PHT = 23:45 UTC previous day
# Runs Sunday–Thursday to cover Mon–Fri mornings
cron(45 23 ? * SUN-THU *)    → RDS start DB cluster

# Stop: Weekdays at 7:00 PM PHT = 11:00 UTC
cron(0 11 ? * MON-FRI *)     → RDS stop DB cluster
```

Note: Times are in UTC. PHT = UTC+8, so 8 AM PHT = 00:00 UTC, 7 PM PHT = 11:00 UTC. The start rule fires on Sun–Thu evenings so the DB is ready by Mon–Fri mornings.

The scheduler needs an IAM role with `rds:StartDBCluster` and `rds:StopDBCluster` permissions.

### Savings Impact

| Scenario | Aurora Cost/Month | vs Always-On |
|----------|------------------|--------------|
| Aurora 24/7 (no shutdown) | ~$28.80 | — |
| Aurora auto-shutdown (approach 1) | ~$7.92 | **~$21 saved** |
| **Dev environment total (with shutdown)** | **~$29–36/mo** | ~$21/mo cheaper |

---

## Per-Service Cost Breakdown

### Edge & Networking

#### CloudFront (CDN)

The **Free plan ($0/month)** covers 1M HTTPS requests and 100 GB data transfer to viewers — both far above what 3 devs will generate.

| Parameter | Value | Calc |
|-----------|-------|------|
| Plan | Free | **$0.00** |
| Included requests | 1M | Devs: ~50K → covered |
| Included data transfer | 100 GB | Devs: < 5 GB → covered |

**CloudFront estimated cost: $0.00 / month**

#### AWS WAF

WAF is included to test the full production edge flow (rate limiting, IP blocking, SQL injection rules). The Web ACL carries a flat $5/month fee regardless of usage.

| Parameter | Value | Calc |
|-----------|-------|------|
| Web ACL (1) | $5 / month flat | **$5.00** |
| Requests inspected (dev) | ~50K | 0.05 × **$0.60/M** = $0.03 |
| WCU surcharge | within 1500 default | $0 |
| Vended logs | ~500 MB (under free tier) | $0 |

**WAF estimated cost: $5.00 / month**

#### Route 53 — DNS

| Parameter | Value | Calc |
|-----------|-------|------|
| Hosted zone (dev subdomain) | 1 | × **$0.50/mo** = $0.50 |
| Standard queries (dev) | ~50K | 0.05 × $0.40/M = $0.02 |

**Route 53 estimated cost: $0.52 / month**

#### Inter-AZ Data Transfer

Negligible at dev volumes. All same-AZ where possible.

**Data Transfer estimated cost: $0.00 / month**

---

### Compute

#### API Gateway (HTTP API)

Dev traffic is well within the **AWS free tier** (1M requests/month for HTTP APIs).

| Parameter | Value | Calc |
|-----------|-------|------|
| API requests (dev) | 100,000 | Free tier covers 1M → **$0** |

**API Gateway estimated cost: $0.00 / month**

#### AWS Lambda (Vote Metrics + Validation + S3 Trigger)

All three functions combined are within the **AWS free tier** (1M invocations + 400,000 GB-seconds/month).

| Function | Invocations | Duration | Compute |
|----------|------------|----------|---------|
| Vote Metrics | ~100K | 100ms × 256MB | 2,500 GB-sec |
| Validation | ~80K | 300ms × 512MB | 12,000 GB-sec |
| S3 Trigger | ~100 | 2s × 256MB | 50 GB-sec |
| **Total** | **~180K** | | **~14,550 GB-sec** |

| Free tier limit | 1M invocations | 400,000 GB-sec |
|-----------------|----------------|-----------------|
| Dev usage | 18% of limit | 3.6% of limit |

**Lambda estimated cost: $0.00 / month** (free tier)

#### AWS Glue (ETL)

Glue runs on-demand when devs upload test CSVs. Worker count is reduced from 10 (prod) to 2, and run duration is much shorter (small test files).

| Parameter | Value | Calc |
|-----------|-------|------|
| Worker type | G.1X (1 DPU / worker) | |
| Worker count | 2 | |
| Runs / month | ~22 | 1 per dev per workday |
| Duration per run | ~15 min (0.25h) | Small test CSVs |
| DPU-hours | 2 × 22 × 0.25 = **11 DPU-hrs** | |
| DPU-hour rate (ap-southeast-1) | **$0.501/hour** | 11 × $0.501 = $5.51 |

> [!NOTE]
> In practice, devs may not run Glue every single day. If Glue runs only 2-3 times per week total, the cost drops to ~$1-2/month. The estimate above assumes daily runs for conservative planning.

**Glue estimated cost: $5.51 / month** (conservative — likely lower)

#### Secrets / Credentials

Use **AWS Systems Manager Parameter Store** (Standard tier, free) instead of Secrets Manager for dev. No database rotation needed in dev.

**Secrets estimated cost: $0.00 / month**

---

### Database

#### Amazon Aurora Serverless v2

Aurora is the hardest service to scale down — the minimum billable is 0.5 ACU even when idle. The auto-shutdown schedule is critical here.

| Parameter | Value | Calc |
|-----------|-------|------|
| Min ACU | 0.5 | |
| Max ACU | 2 (plenty for dev) | |
| ACU-hour rate (ap-southeast-1) | **$0.080 / ACU-hour** | |
| Active hours | 22 days × 9h = **198h** (weekday, after auto-shutdown) | |
| Idle hours (scheduled pause) | Remaining hours | $0 (paused) |
| ACU-hours billed | 0.5 × 198 = **99 ACU-hrs** | |
| Compute cost | 99 × $0.080 = **$7.92** | |
| Storage (dev, ~20 GB) | 20 × **$0.13/GB** = **$2.60** | |
| I/O charges | Included in Aurora v2 | $0 |
| Backup storage | = storage volume | free |

**Aurora estimated cost: $10.52 / month**

> [!IMPORTANT]
> The auto-shutdown schedule assumes `rds:StartDBCluster` / `rds:StopDBCluster` works reliably via EventBridge Scheduler. Test this during initial setup. DB start takes ~1-2 minutes — schedule it 15 minutes before devs arrive (e.g., 7:45 AM).

#### Amazon DynamoDB

| Table | Operations | Volume | Rate | Cost |
|-------|-----------|--------|------|------|
| VoteMetrics | Reads | 50K/mo | $0.25/M | $0.01 |
| VoteMetrics | Writes | 5K/mo | $1.25/M | $0.01 |
| PrecinctStatus | Reads + Writes | 10K/mo | — | $0.01 |
| ElectionMetadata | Reads | 50K/mo | $0.25/M | $0.01 |
| Storage | < 2 GB | | $0.285/GB | $0.57 |
| **Total DynamoDB** | | | | **$0.61 / month** |

**DynamoDB estimated cost: $0.61 / month**

---

### Storage

#### Amazon S3

| Bucket | Size | Cost |
|--------|------|------|
| Static UI (dev build) | ~100 MB | $0.003 |
| CSV Uploads (test data) | ~2 GB | $0.05 |
| Parquet Raw (test output) | ~3 GB | $0.08 |
| S3 request ops | ~10K | $0.01 |
| **Total S3** | | **$0.14 / month** |

**S3 estimated cost: $0.14 / month**

---

### Messaging & Queues

| Service | Usage | Cost |
|---------|-------|------|
| **SNS** | ~500 notifications (Glue test failures, alerts) | $0.00 (first 1M publishes free / negligible) |
| **SQS** | ~100 messages (DLQ testing) | $0.00 (free tier covers dev volume) |
| **Total** | | **$0.00 / month** |

---

### Observability

#### CloudWatch

| Parameter | Value | Calc |
|-----------|-------|------|
| Logs ingested (dev) | ~5 GB | × $0.50 = $2.50 |
| Logs storage | ~10 GB | × $0.03 = $0.30 |
| Dashboards | 1 (shared dev dashboard) | × $3.00 = $3.00 |
| Alarms | 5 (critical only) | × $0.10 = $0.50 |
| Metrics (custom) | ~20 (first 10K free) | $0.00 |
| **Total CloudWatch** | | **$6.30 / month** |

#### AWS X-Ray

Free tier covers 100K traces/month — sufficient for dev.

**X-Ray estimated cost: $0.00 / month**

---

### Ad-Hoc Analytics

#### Amazon Athena

| Parameter | Value | Calc |
|-----------|-------|------|
| Reconciliation scans | 5 GB Parquet × 5 scans | 25 GB total |
| Rate | $5/TB scanned | $0.13 |

**Athena estimated cost: $0.13 / month**

---

## Monthly Summary

### Cost Category Roll-Up

| Category | Monthly Cost (USD) | % of Total |
|----------|-------------------|------------|
| **Edge & Networking** (CloudFront, WAF, Route 53) | $5.52 | 15% |
| **Compute** (API Gateway, Lambda, Glue, SSM) | $5.51 | 15% |
| **Database** (Aurora v2, DynamoDB) | $11.13 | 31% |
| **Storage** (S3) | $0.14 | < 1% |
| **Messaging** (SNS, SQS) | $0.00 | 0% |
| **Observability** (CloudWatch, X-Ray) | $6.30 | 17% |
| **Analytics** (Athena) | $0.13 | < 1% |
| **TOTAL** | **~$29 / month** | 100% |

> [!NOTE]
> Rounded up to **~$36/month** for budgeting (includes a buffer for unexpected usage, additional test data, or extended debugging sessions). The realistic floor is **~$29/month** with conservative usage.

### Cost Distribution

| Category | % of Total | Runs From |
|----------|-----------|-----------|
| Aurora (compute + storage) | 36% | 0.5 ACU minimum — unavoidable while running |
| CloudWatch | 22% | Dashboards + log storage |
| Glue | 19% | Depends on how often devs run ETL jobs |
| WAF (Web ACL) | 17% | Flat $5/mo |
| Route 53 + DynamoDB + S3 + Athena | 6% | Trivial at dev volumes |

### Auto-Shutdown Impact

| Scenario | Monthly Cost | vs Always-On |
|----------|-------------|--------------|
| **Approach 1 (auto-shutdown)** | **~$29** | — |
| Always-on (no shutdown) | ~$50 | +$21/month |
| **Annualized (auto-shutdown, floor)** | **~$348** | — |

---

## Annual Projection

| Scenario | Monthly × 12 |
|----------|-------------|
| Dev environment (auto-shutdown, all services) | **~$348 / year** |
| Dev environment (always-on) | ~$600 / year |
| Prod environment (un-optimized, 1 peak + 11 idle) | ~$1,517 / year |
| Prod environment (optimized, plan-switching) | ~$1,117 / year |

---

## Comparison with Production

| Aspect | Dev (Auto-Shutdown) | Prod (Optimized) | Prod (Un-Optimized) |
|--------|--------------------|-----------------|---------------------|
| **Monthly cost** | ~$29 | ~$402 (peak) / ~$65 (idle) | ~$703 (peak) / ~$74 (idle) |
| **Annual cost** | ~$348 | ~$1,117 | ~$1,517 |
| **Always-on?** | No (9h weekdays) | No (1 peak month only) | Yes |
| **CloudFront** | Free plan | Business plan ($200) | Pay-as-you-go ($402) |
| **WAF** | Yes ($5) | Yes (bundled in Business plan) | Yes ($37) |
| **Route 53** | Yes ($0.50) | Yes (bundled in Business plan) | Yes ($21) |
| **API Gateway** | Free tier | ~$54 | ~$54 |
| **Lambda** | Free tier | ~$46 | ~$47 |
| **Glue** | ~$5.50 | ~$10 | ~$10 |
| **Aurora** | ~$10.52 (auto-shutdown) | ~$51 | ~$51 |
| **DynamoDB** | ~$0.60 | ~$23 | ~$23 |
| **CloudWatch** | ~$6.30 | ~$36 | ~$37 |

---

## Notes & Disclaimers

1. **Public pricing only** — uses AWS published prices. Enterprise discounts may reduce costs further.
2. **Free Tier assumed** for dev — dev traffic fits comfortably within Lambda (1M invocations) and API Gateway HTTP (1M requests) free tiers.
3. **Pricing as of July 2026** — AWS prices change. Re-validate before provisioning.
4. **Currency** — all figures in USD (~₱58/USD as of July 2026).
5. **Auto-shutdown reliability** — the Aurora cost assumes EventBridge Scheduler works consistently. Test this during dev environment setup. If the scheduler fails, Aurora runs 24/7 and adds ~$21/month.
6. **Glue costs vary** — actual cost depends on how often devs run ETL jobs. Estimate assumes daily runs (conservative). Typical usage may be 2-3× lower.
7. **Observability costs** — can be reduced further by keeping only ERROR-level logs in dev and using a single shared dashboard.
8. **Region** — ap-southeast-1 (Singapore). Prices are ~10-20% higher than us-east-1.
9. **Verification status** — prices based on the same sources as [COSTS.md](./COSTS.md) (CloudFront + WAF ✅ verified from AWS pricing pages; others ⚠️ knowledge-based for ap-southeast-1).

---

## References

Same AWS pricing pages as the [production estimate](./COSTS.md#references). Key ones for dev:

| Service | AWS Pricing Page |
|---------|-----------------|
| CloudFront (Free plan) | https://aws.amazon.com/cloudfront/pricing/ |
| WAF | https://aws.amazon.com/waf/pricing/ |
| Lambda (Free Tier) | https://aws.amazon.com/lambda/pricing/ |
| API Gateway (Free Tier) | https://aws.amazon.com/api-gateway/pricing/ |
| Aurora Serverless v2 | https://aws.amazon.com/rds/aurora/pricing/ |
| EventBridge Scheduler | https://aws.amazon.com/eventbridge/pricing/ |

> [!TIP]
> Use the **[AWS Pricing Calculator](https://calculator.aws)** to validate this estimate against the latest prices and your specific dev workload profile.
