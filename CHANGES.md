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