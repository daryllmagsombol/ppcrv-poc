# Change Log

Tracks all edits made to documentation in the `pprcv-poc` repository. Entries are listed in reverse chronological order (newest first).

> [!NOTE]
> This file is manually maintained alongside each edit. When modifying any documentation file (`README.md`, `COSTS.md`, architecture docs, etc.), prepend a new entry to this log.

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

## 2026-07-03 — Synced README Cost Comparison with audited COSTS.md totals

**Files changed:** `README.md`
**Author:** Team Leader (Claude)
**Summary:** Updated the README's Cost Comparison section to reflect the audited numbers from COSTS.md (previously still showed the old $630 / $367 / $1,445 figures).

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
- Added note flags at the top of each table indicating that figures were audited 2026-07-03 against AWS ap-southeast-1 public pricing, and pointing to the COSTS.md Notes & Disclaimers for verification status.

### Why
- After the COSTS.md audit, the README was left out of sync — its Cost Comparison section still cited the pre-audit totals.
- The user explicitly asked whether the README was also updated; the honest answer was "no, I'll fix it now".
- Keeping these two documents in sync is critical since the README is the entry point and COSTS.md is the detailed companion.

---

## 2026-07-03 — Removed duplicate outdated architecture-level comparison table from README.md

**Files changed:** `README.md`, `CHANGES.md`
**Author:** Team Leader (Claude)
**Summary:** The old simplified architecture comparison table (showing $15 idle / $220 peak) was a duplicate left behind when the updated detailed table ($98 idle / $548 peak with Route 53, Secrets Manager, Observability) was added. Removed rows 608-619 from README.md.

### What changed
- Removed duplicate table and its "Savings: ~70% at peak..." caption
- The correct, updated Architecture-Level table at line 542 remains
- No data loss — the old table's values contradicted the audited totals in COSTS.md

### Why
- The table was a stale duplicate from the pre-audit draft and contradicted the correct figures
- Having two tables with different numbers was confusing and risked the wrong numbers being cited

---

## 2026-07-03 — Fixed arithmetic error in optimized annual projection; documented CloudFront plan-switching model

**Files changed:** `COSTS.md`, `README.md`
**Author:** Team Leader (Claude)
**Summary:** The user asked whether the CloudFront Business plan is meant to be subscribed only for the election month and whether idle months were costed correctly. That question exposed a real arithmetic error — the optimized annual had been reported as **~$816/year** in one section of COSTS.md and **~$875/year** in another (both wrong). Recomputed with a proper plan-switching model and corrected to **~$1,117/year**.

### What changed

**Root cause — an arithmetic error I should have caught earlier:**
- The previous optimized annual equation in COSTS.md was: "$402 (peak) + 11 × ~$74 (idle) = ~$816/year". This was wrong on two counts:
  1. **Arithmetic** — $402 + (11 × $74) actually equals **$1,216**, not $816. A character transposition error.
  2. **Idle baseline** — $74 was inherited from the un-optimized idle, where it included pay-as-you-go CloudFront/R53/Secrets line items that are absorbed or zeroed under the optimized plan-switching scenario. The correct optimized idle baseline is **~$65** (not $74) once the CloudFront Free plan and SSM Parameter Store swap are applied.

**Replaced the hand-wavy "annual (with 11 idle months @ ~$74)" line with an explicit plan-switching model:**

| Period | Plan | Cost |
|--------|------|------|
| Peak month (1) | CloudFront Business ($200/mo, no overage) | ~$402 |
| Idle months (11) | CloudFront Free ($0/mo) + WAF attached | ~$65 each |
| **Optimized annual total** | | **~$1,117/year** |

**Added a new "Plan-Switching Mechanics — Verify With AWS" subsection** in COSTS.md listing explicit assumptions that must be confirmed:
- Can CloudFront plans be switched month-to-month? (assumed yes)
- Is there a switching penalty? (assumed no)
- Does WAF remain attached when the CF plan changes? (assumed yes)
- Does the Business plan absorb WAF request fees, or only the WAF feature itself? (kept WAF request fees outside the plan as a conservative assumption)

**Added two idle scenarios** — idle month with WAF stays attached (~$65/mo, recommended for security) vs WAF detached during idle (~$60/mo, saves $55/year but loses year-round protection). Recommended keeping WAF attached given the small saving.

**Idle month breakdown itemized explicitly** in COSTS.md so the $65/month figure is auditable:
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

**Updated the Comparison with Initial EC2 Proposal table** in COSTS.md to use $1,117 (with WAF attached) and $1,062 (with WAF detached) instead of $816.

**Updated the `xychart-beta` annual comparison** in COSTS.md from `bar [8750, 1517, 816]` to `bar [8750, 1517, 1117]`.

**Updated the savings claim** from "~90% cheaper annually" to "~87% cheaper annually" (WAF attached) / "~88% cheaper annually" (WAF detached).

**Synced README.md:**
- Annual Projection table updated: ~$8,750 / ~$1,517 / **~$1,117** / ~$1,062 (added "WAF detached" row)
- "Annual savings" claim updated to "~83% (un-optimized) to ~87% (optimized, WAF attached)"
- Added IMPORTANT callout describing the plan-switching assumption and linking to COSTS.md "Plan-Switching Mechanics" subsection
- Added CAUTION callout explicitly noting the previous $816 figure was an arithmetic error and stating the corrected ~$1,117
- Comprehensive Monthly Estimate table updated: replaced single "Optimized ~$402" row with two rows — peak month ($402) and idle month ($65)
- Key Insights updated: "Idle cost ~$65/month" (was $74), "Optimized annual ~$1,117" (was $816), savings "~87% vs EC2" (was ~90%)

### Why
- The user's question "do I only subscribe for one month?" was the right question to ask — it forced me to re-examine the cost model assumption and exposed both an arithmetic error and a logical inconsistency (the optimized idle number was inherited from the un-optimized idle that included line items the optimized scenario eliminates).
- Errors like this are exactly why user review of specs is important — the previous $816 figure looked plausible on first read because the optimized scenario is genuinely much cheaper than un-optimized, but the correct ~$1,117 is still ~87% cheaper than the EC2 proposal, which is the actual story worth telling.
- Documenting the plan-switching model explicitly forces a verification checkpoint — the "month-to-month switching without penalty is assumed but not confirmed" disclaimer is critical because the entire optimized scenario depends on it being possible.

---

## 2026-07-03 — Cost audit: corrected AWS prices, added missed services, added CloudFront flat-rate plan

**Files changed:** `COSTS.md`
**Author:** Team Leader (Claude)
**Summary:** Audited `COSTS.md` against current AWS ap-southeast-1 public pricing. Corrected two material price errors (WAF request rate, Glue Catalog storage), applied region-specific rate corrections (CloudFront + Aurora storage), added two previously-missed services (Route 53 DNS, Secrets Manager), and surfaced the new 2026 CloudFront flat-rate Business plan as the single biggest cost optimization.

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

## 2026-07-03 — Added COSTS.md and rewrote README Cost Comparison section

**Files changed:** `COSTS.md` (new), `README.md`
**Author:** Team Leader (Claude)
**Summary:** Created comprehensive cost-estimate document for the serverless architecture in ap-southeast-1 and rewrote the README Cost Comparison section to summarize it with a link to the full document.

### What changed
- **Created `COSTS.md`** — comprehensive monthly cost estimate covering:
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
  - Added a callout block linking to `COSTS.md` for full details
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