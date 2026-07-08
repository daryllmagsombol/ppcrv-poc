# PPCRV — Terraform Infrastructure Strategy

Proposed Infrastructure-as-Code approach for the PPCRV serverless election monitoring platform on AWS, using **Terraform** with **GitHub Actions** CI/CD and **OIDC** authentication.

> [!NOTE]
> This is a **proposal** — no Terraform code has been written yet. The IaC choice is still open. See [CLOUDFORMATION.md](./CLOUDFORMATION.md) for the SAM/CloudFormation alternative and a side-by-side comparison.

---

## Table of Contents

- [Why Terraform](#why-terraform)
- [Module Architecture](#module-architecture)
- [State Management](#state-management)
- [Authentication & Authorization](#authentication--authorization)
- [CI/CD Pipeline](#cicd-pipeline)
- [Environment Strategy](#environment-strategy)
- [Development Workflow](#development-workflow)
- [Cost Strategy](#cost-strategy)
- [Getting Started](#getting-started)

---

## Why Terraform

| Criteria | Terraform | AWS CDK | AWS SAM |
|----------|-----------|---------|---------|
| Language | HCL (declarative) | TypeScript/Python (imperative) | YAML |
| State tracking | Native (S3 + DynamoDB) | CloudFormation (behind CDK) | CloudFormation |
| Plan output | `terraform plan` shows diff | `cdk diff` (less granular) | `sam deploy --dry-run` |
| Multi-region | Native | Via StackSets | Manual |
| CI/CD fit | Excellent (plan as PR comment) | Good | Good |
| Learning curve | Moderate | Moderate-high | Low |
| Community modules | 2,000+ | Limited | N/A |

**Decision:** Terraform for this project because:

- **Declarative planning** — `terraform plan` is human-readable and PR-reviewable; crucial for election infrastructure where mistakes are high-stakes
- **State isolation** — each environment has its own state file; no accidental prod changes from a dev run
- **Provider maturity** — the AWS provider is HashiCorp-maintained, covers every service in the architecture, and is battle-tested
- **CI/CD native** — plan-on-PR / apply-on-merge pattern maps naturally to GitHub Actions
- **No CloudFormation dependency** — avoids AWS's deployment service lock-in

---

## Module Architecture

### Component Diagram

The Terraform codebase is organized into modules that mirror the architecture's service boundaries. Each module manages a single concern and exposes clear output values for inter-module wiring.

```mermaid
graph TB
    classDef module fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef awsService fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef person fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef boundary fill:#f5f5f5,stroke:#9e9e9e,stroke-width:1px,stroke-dasharray: 5 5

    Dev["Developer"]:::person

    subgraph TF["Terraform Codebase"]
        subgraph Modules[" "]
            State["State Backend (backend.tf)<br/><b>S3 + DynamoDB</b><br/>Remote state storage with locking & versioning"]:::module
            Net["Network Module (modules/network/)<br/><b>CloudFront + WAF + Route53</b><br/>CDN, edge caching, DDoS, DNS"]:::module
            Comp["Compute Module (modules/compute/)<br/><b>Lambda + API Gateway</b><br/>Serverless API layer"]:::module
            Stor["Storage Module (modules/storage/)<br/><b>S3 + DynamoDB + Aurora</b><br/>Data persistence"]:::module
            ETL["ETL Module (modules/etl/)<br/><b>Glue + Athena</b><br/>CSV processing pipeline"]:::module
            Msg["Messaging Module (modules/messaging/)<br/><b>SNS + SQS</b><br/>Alerting, dead-letter queues"]:::module
            Obs["Observability Module (modules/observability/)<br/><b>CloudWatch + X-Ray</b><br/>Logs, metrics, dashboards"]:::module
            IAMMod["IAM Module (modules/iam/)<br/><b>IAM Roles + Policies</b><br/>Service-to-service permissions"]:::module
            Boot["Bootstrap (bootstrap/)<br/><b>One-time setup</b><br/>State backend + OIDC provider"]:::module
        end
    end

    subgraph AWS["AWS Account (ap-southeast-1)"]
        CF["CloudFront<br/><b>CDN</b><br/>Edge caching, WAF, DDoS"]:::awsService
        APIGW["API Gateway<br/><b>REST API</b><br/>Rate limiting, routing"]:::awsService
        LVal["Lambda: Validation<br/><b>Node.js</b><br/>Checksum + QR validation"]:::awsService
        LMet["Lambda: Metrics<br/><b>Node.js</b><br/>Vote metrics queries"]:::awsService
        LTrig["Lambda: Trigger<br/><b>Python</b><br/>S3 event → Glue trigger"]:::awsService
        Glue["AWS Glue<br/><b>PySpark</b><br/>CSV ETL pipeline"]:::awsService
        DDBMet["DynamoDB: Metrics<br/><b>NoSQL</b><br/>Aggregated vote results"]:::awsService
        DDBCtrl["DynamoDB: Control<br/><b>NoSQL</b><br/>Precinct status tracking"]:::awsService
        S3Up["S3: Upload Bucket<br/><b>Object Storage</b><br/>Volunteer CSV uploads"]:::awsService
        S3Par["S3: Parquet<br/><b>Object Storage</b><br/>Raw data audit trail"]:::awsService
        S3UI["S3: Static UI<br/><b>Object Storage</b><br/>Frontend hosting"]:::awsService
        Aurora["Aurora Serverless v2<br/><b>PostgreSQL</b><br/>Validation records"]:::awsService
        SNS["SNS<br/><b>Pub/Sub</b><br/>Failure/success alerts"]:::awsService
        SQS["SQS DLQ<br/><b>Queue</b><br/>Dead-letter queue"]:::awsService
        CW["CloudWatch<br/><b>Monitoring</b><br/>Logs, metrics, alarms"]:::awsService
        Athena["Athena<br/><b>Serverless SQL</b><br/>Ad-hoc queries on Parquet"]:::awsService
    end

    Dev -->|terraform init| State
    State -->|Read state| IAMMod

    Net -->|Manages| CF
    Net -->|DNS + WAF| APIGW
    Comp -->|Manages| APIGW
    Comp -->|Deploys| LVal
    Comp -->|Deploys| LMet
    Comp -->|Deploys| LTrig
    ETL -->|Manages| Glue
    ETL -->|Manages| Athena
    Stor -->|Manages| DDBMet
    Stor -->|Manages| DDBCtrl
    Stor -->|Manages| S3Up
    Stor -->|Manages| S3Par
    Stor -->|Manages| S3UI
    Stor -->|Manages| Aurora
    Msg -->|Manages| SNS
    Msg -->|Manages| SQS
    Obs -->|Manages| CW
    IAMMod -->|Attaches role| LVal
    IAMMod -->|Attaches role| LMet
    IAMMod -->|Attaches role| LTrig
    IAMMod -->|Attaches role| Glue
```

### Directory Structure

```
terraform/
├── backend.tf              # Remote state config (S3 + DynamoDB)
├── providers.tf            # AWS provider configuration
├── main.tf                 # Root module — orchestrates sub-modules
├── variables.tf            # Global input variables
├── outputs.tf              # Global output values
├── locals.tf               # Local computed values (tags, naming)
│
├── environments/           # Environment-specific configurations
│   ├── dev/
│   │   ├── terraform.tfvars
│   │   └── region.tfvars
│   ├── staging/
│   │   ├── terraform.tfvars
│   │   └── region.tfvars
│   └── prod/
│       ├── terraform.tfvars
│       └── region.tfvars
│
├── modules/
│   ├── network/            # CloudFront, WAF, Route53
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── compute/            # Lambda functions, API Gateway
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── storage/            # S3, DynamoDB, Aurora Serverless
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── etl/                # Glue jobs, Athena
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── messaging/          # SNS, SQS
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── observability/      # CloudWatch, X-Ray
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── iam/                # IAM roles, policies, OIDC
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
│
├── bootstrap/              # One-time setup (run from local machine)
│   ├── backend.tf
│   ├── main.tf             # S3 bucket + DynamoDB table for state
│   └── oidc.tf             # GitHub OIDC provider + IAM role
│
└── templates/              # Lambda source code (deployed via archive)
    ├── validation/
    │   └── index.js
    ├── metrics/
    │   └── index.js
    └── trigger/
        └── index.py
```

---

## State Management

Terraform's state is stored remotely in S3 with DynamoDB locking — enabling safe concurrent access from CI/CD runners and local machines.

```
┌──────────────────────────────────────────────────────────┐
│                    Terraform State                        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────┐    ┌─────────────────────────┐  │
│  │     S3 Bucket        │    │    DynamoDB Table        │  │
│  │  (pprcv-tf-state)    │    │  (pprcv-tf-locks)        │  │
│  │                      │    │                          │  │
│  │  dev/terraform.tfstate│    │  LockID (partition key)  │  │
│  │  staging/terraform...│    │  Lock records for         │  │
│  │  prod/terraform.tf...│    │  concurrent run prevention│  │
│  │                      │    │                          │  │
│  │  Versioning: ON      │    │  Pay-per-request: ON    │  │
│  │  Encryption: AES-256 │    │  Cost: ~$0.01/month     │  │
│  └─────────────────────┘    └─────────────────────────┘  │
│                                                          │
│  Benefits:                                                │
│  • Versioned state — roll back if corruption occurs       │
│  • Locked applies — no concurrent overwrites              │
│  • Shared access — CI/CD + team members use same state    │
│  • Encryption at rest — state may contain sensitive ARNs  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### State Isolation by Environment

Each environment has its own state file path, preventing cross-environment contamination:

| Environment | State Key | Locking |
|-------------|-----------|---------|
| `dev` | `env:/dev/pprcv/terraform.tfstate` | Shared DynamoDB |
| `staging` | `env:/staging/pprcv/terraform.tfstate` | Shared DynamoDB |
| `prod` | `env:/prod/pprcv/terraform.tfstate` | Shared DynamoDB |

A workspace-per-environment approach (via `terraform workspace`) is avoided because:

- Workspace state can be accidentally destroyed with `terraform workspace delete`
- State file paths are less explicit for auditing
- Separate state keys in S3 are more transparent and recoverable

---

## Authentication & Authorization

### OIDC Flow — GitHub Actions to AWS

No static AWS access keys are ever stored. GitHub Actions authenticates to AWS using **OpenID Connect (OIDC)**, a federated identity protocol that exchanges a GitHub-signed JWT for temporary AWS credentials.

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant Repo as GitHub Repository
    participant Runner as GitHub Actions Runner
    participant GH_OIDC as GitHub OIDC Provider
    participant STS as AWS STS
    participant IAM as AWS IAM
    participant AWS as Target AWS Services

    Note over Dev,AWS: ─── Trigger ───
    Dev->>Repo: git push origin main
    Repo->>Runner: Start workflow run

    Note over Dev,AWS: ─── OIDC Token Request ───
    Runner->>Runner: Read workflow YAML<br/>permissions: id-token: write
    Runner->>GH_OIDC: POST /_apis/token<br/>(bearer: GITHUB_TOKEN)
    Note over GH_OIDC: Mint JWT with claims:<br/>{<br/>  "sub": "repo:org/pprcv-poc:ref:refs/heads/main"<br/>  "aud": "sts.amazonaws.com"<br/>  "iss": "https://token.actions.githubusercontent.com"<br/>}
    GH_OIDC-->>Runner: Return signed JWT

    Note over Dev,AWS: ─── AWS AssumeRoleWithWebIdentity ───
    Runner->>STS: AssumeRoleWithWebIdentity<br/>RoleARN: arn:aws:iam::ACCT:role/pprcv-gh-actions<br/>Token: JWT
    STS->>IAM: Validate JWT signature
    IAM-->>STS: JWT valid (signed by GitHub's OIDC public key)
    STS->>IAM: Evaluate trust policy
    Note over IAM: Condition check:<br/>"token.actions.githubusercontent.com:sub"<br/>== "repo:org/pprcv-poc:ref:refs/heads/main"<br/><br/>Only this repo + branch passes.<br/>Any other repo is rejected.
    IAM-->>STS: Trust policy satisfied
    STS-->>Runner: Return temp credentials<br/>{<br/>  AccessKeyId: AKIA...<br/>  SecretAccessKey: ...<br/>  SessionToken: ...<br/>  Expiration: 1 hour TTL<br/>}

    Note over Dev,AWS: ─── Terraform Execution ───
    Runner->>Runner: AWS_ACCESS_KEY_ID,<br/>AWS_SECRET_ACCESS_KEY,<br/>AWS_SESSION_TOKEN set in env
    Runner->>Runner: terraform init
    Runner->>Runner: terraform plan
    Runner->>AWS: terraform apply
    AWS-->>Runner: Resource creation complete

    Note over Dev,AWS: ─── Credential Expiry ───
    Runner->>Runner: Session expires after 1 hour<br/>— no cleanup needed
```

### IAM Trust Policy — The Security Gate

The trust policy on the IAM role is the **sole security boundary** for the pipeline. It specifies **exactly** which GitHub repository and branch can assume the role:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
    },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": [
        "repo:ppcrv/pprcv-poc:ref:refs/heads/main",
        "repo:ppcrv/pprcv-poc:ref:refs/heads/staging",
        "repo:ppcrv/pprcv-poc:ref:refs/heads/dev"
      ]
    }
  }
}
```

This means: **Even if a malicious workflow runs in a different repository, it can never assume this role** — the JWT's `sub` claim is signed by GitHub and cannot be forged.

---

## CI/CD Pipeline

### Activity Diagram — Pull Request & Merge Workflow

The pipeline enforces a **plan-on-PR, apply-on-merge** gate. Infrastructure changes are reviewed as `terraform plan` output before any resource is created or modified.

```mermaid
flowchart TD
    classDef process fill:#e3f2fd,stroke:#1976d2,stroke-width:1px
    classDef decision fill:#fff9c4,stroke:#f9a825,stroke-width:1px
    classDef terminal fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef action fill:#fce4ec,stroke:#c62828,stroke-width:1px
    classDef note fill:#f5f5f5,stroke:#9e9e9e,stroke-width:1px,stroke-dasharray: 5 5

    Start((Start)):::terminal
    PR["Developer creates PR<br/>changing terraform/ files"]:::process
    Trigger["GitHub Actions triggers<br/>terraform.yml on pull_request"]:::process
    Checkout["actions/checkout@v4"]:::process
    OIDC["aws-actions/configure-aws-credentials@v4<br/>(Assume OIDC role)"]:::process
    SetupTF["hashicorp/setup-terraform@v3"]:::process
    Init["terraform init<br/>(Download providers, pull state)"]:::process
    Fmt["terraform fmt -check"]:::process
    Validate["terraform validate"]:::process
    Plan["terraform plan -out=tfplan"]:::process
    PostPlan["Post plan as PR comment"]:::process
    HasChanges{"Plan has<br/>changes?"}:::decision
    Review["Review plan in PR"]:::process
    Approved{"Changes<br/>approved?"}:::decision
    Merge["Merge PR into main branch"]:::action
    Fix["Push fixes to PR branch<br/>(re-triggers plan)"]:::action
    NoChanges["No infra changes needed"]:::process
    End1((End)):::terminal
    PushMain["Push to main branch<br/>triggers new workflow run"]:::process
    Init2["terraform init"]:::process
    Plan2["terraform plan -out=tfplan"]:::process
    Apply["terraform apply -auto-approve tfplan"]:::action
    Success{"Apply<br/>succeeds?"}:::decision
    Output["terraform output<br/>(Display resource ARNs, endpoints)"]:::process
    End2((End)):::terminal
    Investigate["terraform show<br/>(Investigate error)"]:::action
    PartialState{"Partial state<br/>written?"}:::decision
    Retry["terraform apply -auto-approve<br/>(Retry — resume from partial state)"]:::action
    FixBug["Fix bug, push new commit<br/>(Full re-apply)"]:::action

    PlanNote["Plan output shows:<br/>• Resources to CREATE (+)<br/>• Resources to DESTROY (-)<br/>• Resources to UPDATE (~)<br/>• No changes (√)"]:::note
    ApplyNote["Applies are sequential:<br/>DynamoDB lock prevents<br/>concurrent runs"]:::note
    RetryNote["Cycle repeats until<br/>plan is acceptable"]:::note

    Start --> PR
    PR --> Trigger
    Trigger --> Checkout
    Checkout --> OIDC
    OIDC --> SetupTF
    SetupTF --> Init
    Init --> Fmt
    Fmt --> Validate
    Validate --> Plan
    Plan -.- PlanNote
    Plan --> PostPlan
    PostPlan --> HasChanges

    HasChanges -->|Yes| Review
    Review --> Approved
    Approved -->|Yes| Merge
    Approved -->|No| Fix
    Fix -.- RetryNote
    Fix --> Trigger

    HasChanges -->|No| NoChanges
    NoChanges --> End1

    Merge --> PushMain
    FixBug --> PushMain
    PushMain --> Init2
    Init2 --> Plan2
    Plan2 --> Apply
    Apply -.- ApplyNote
    Apply --> Success

    Success -->|Yes| Output
    Output --> End2

    Success -->|No| Investigate
    Investigate --> PartialState
    PartialState -->|Yes| Retry
    PartialState -->|No| FixBug
```

### Workflow Definition

```yaml
# .github/workflows/terraform.yml
name: 'Terraform'

on:
  push:
    branches: [main, staging, dev]
    paths: ['terraform/**']
  pull_request:
    paths: ['terraform/**']

permissions:
  id-token: write   # OIDC token issuance
  contents: read    # Repository checkout
  pull-requests: write  # Post plan as PR comment

jobs:
  terraform:
    name: Terraform ${{ github.event_name == 'pull_request' && 'Plan' || 'Apply' }}
    runs-on: ubuntu-latest
    environment: ${{ github.ref_name }}

    defaults:
      run:
        working-directory: ./terraform
        shell: bash

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/pprcv-gh-actions-${{ github.ref_name }}
          aws-region: ap-southeast-1

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.9.5

      - name: Terraform Init
        run: |
          terraform init -backend-config="environments/${{ github.ref_name }}/backend.hcl"

      - name: Terraform Format
        run: terraform fmt -check -recursive

      - name: Terraform Validate
        run: terraform validate

      - name: Terraform Plan
        id: plan
        run: |
          terraform plan \
            -var-file="environments/${{ github.ref_name }}/terraform.tfvars" \
            -out=tfplan \
            -no-color 2>&1 | tee plan_output.txt
          echo "plan_output=$(cat plan_output.txt)" >> $GITHUB_OUTPUT

      # On PRs: post plan as a comment
      - name: Post Plan to PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const output = `## Terraform Plan (\`${{ github.ref_name }}\`)
            \`\`\`
            ${{ steps.plan.outputs.plan_output }}
            \`\`\`
            `;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: output
            });

      # On push to main/staging/dev: apply
      - name: Terraform Apply
        if: github.event_name == 'push' && github.ref_type == 'branch'
        run: terraform apply -auto-approve tfplan
```

---

## Environment Strategy

### Deployment Diagram — Multi-Environment Topology

Each environment is fully isolated with its own state file, AWS resources, and variable configuration. The topology mirrors production for all environments to catch issues early.

```mermaid
graph TB
    classDef envDev fill:#e8f5e9,stroke:#388e3c,stroke-width:1px
    classDef envStg fill:#fff3e0,stroke:#f57c00,stroke-width:1px
    classDef envPrd fill:#fce4ec,stroke:#c62828,stroke-width:1px
    classDef state fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1px
    classDef lock fill:#e1f5fe,stroke:#0288d1,stroke-width:1px
    classDef gh fill:#f5f5f5,stroke:#616161,stroke-width:1px,stroke-dasharray: 5 5
    classDef awsLabel fill:#fff,stroke:#9e9e9e,stroke-width:1px

    subgraph AWS_ACCT["AWS Account"]
        AWS_LBL[" "]:::awsLabel
        subgraph REGION["ap-southeast-1"]
            subgraph DEV["dev"]
                DEV_CF["CloudFront<br/>(distro-pprcv-dev)"]:::envDev
                DEV_API["API Gateway<br/>(pprcv-api-dev)"]:::envDev
                DEV_LAMBDA["Lambda Functions<br/>(pprcv-*-dev)"]:::envDev
                DEV_DDB["DynamoDB<br/>(VoteMetrics-dev)"]:::envDev
                DEV_AURORA["Aurora Serverless<br/>(pprcv-val-dev)"]:::envDev
                DEV_S3["S3 Buckets<br/>(pprcv-*-dev)"]:::envDev
                DEV_GLUE["Glue Jobs<br/>(pprcv-etl-dev)"]:::envDev
                DEV_MSG["SNS/SQS<br/>(pprcv-*-dev)"]:::envDev
            end

            subgraph STAGING["staging"]
                STG_CF["CloudFront<br/>(distro-pprcv-staging)"]:::envStg
                STG_API["API Gateway<br/>(pprcv-api-staging)"]:::envStg
                STG_LAMBDA["Lambda Functions<br/>(pprcv-*-staging)"]:::envStg
                STG_DDB["DynamoDB<br/>(VoteMetrics-staging)"]:::envStg
                STG_AURORA["Aurora Serverless<br/>(pprcv-val-staging)"]:::envStg
                STG_S3["S3 Buckets<br/>(pprcv-*-staging)"]:::envStg
                STG_GLUE["Glue Jobs<br/>(pprcv-etl-staging)"]:::envStg
                STG_MSG["SNS/SQS<br/>(pprcv-*-staging)"]:::envStg
            end

            subgraph PROD["prod"]
                PROD_CF["CloudFront<br/>(distro-pprcv-prod)"]:::envPrd
                PROD_API["API Gateway<br/>(pprcv-api-prod)"]:::envPrd
                PROD_LAMBDA["Lambda Functions<br/>(pprcv-*-prod)"]:::envPrd
                PROD_DDB["DynamoDB<br/>(VoteMetrics-prod)"]:::envPrd
                PROD_AURORA["Aurora Serverless<br/>(pprcv-val-prod)"]:::envPrd
                PROD_S3["S3 Buckets<br/>(pprcv-*-prod)"]:::envPrd
                PROD_GLUE["Glue Jobs<br/>(pprcv-etl-prod)"]:::envPrd
                PROD_MSG["SNS/SQS<br/>(pprcv-*-prod)"]:::envPrd
            end

            subgraph STATE["S3 State Bucket (pprcv-tf-state)"]
                DEV_STATE["env:/dev/pprcv/terraform.tfstate"]:::state
                STG_STATE["env:/staging/pprcv/terraform.tfstate"]:::state
                PROD_STATE["env:/prod/pprcv/terraform.tfstate"]:::state
            end

            LOCKS["DynamoDB Lock Table<br/>(pprcv-tf-locks)"]:::lock

            DEV_STATE -.->|"State of dev infra"| DEV
            STG_STATE -.->|"State of staging infra"| STAGING
            PROD_STATE -.->|"State of prod infra"| PROD
            LOCKS -.->|Lock| DEV_STATE
            LOCKS -.->|Lock| STG_STATE
            LOCKS -.->|Lock| PROD_STATE
        end
    end

    subgraph GH["GitHub"]
        MAIN["main branch"]:::gh
        STG_BR["staging branch"]:::gh
        DEV_BR["dev branch"]:::gh
        GH_OIDC["GitHub Actions<br/>OIDC Roles"]:::gh
    end

    MAIN -->|"Trigger apply"| PROD
    STG_BR -->|"Trigger apply"| STAGING
    DEV_BR -->|"Trigger apply"| DEV
```

### Environment Matrix

| Aspect | `dev` | `staging` | `prod` |
|--------|-------|-----------|--------|
| **Branch** | `dev` | `staging` | `main` |
| **Trigger** | Push to dev | Push to staging | Push to main |
| **Aurora min ACU** | 0.5 (scales to 0) | 0.5 | 2.0 |
| **DynamoDB capacity** | On-demand | On-demand | On-demand |
| **CloudFront price class** | US/Europe only | All edge locations | All edge locations |
| **WAF enabled** | No | Yes | Yes |
| **Route53 DNS** | Subdomain (dev.) | Subdomain (staging.) | Main domain |
| **Cost target** | ~$5-10/mo | ~$20-30/mo | ~$65 idle / $402 peak |

---

## Development Workflow

### Sequence Diagram — Full Lifecycle

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant Local as Local Machine
    participant PR as GitHub PR
    participant GH_Plan as GitHub Actions (Plan)
    participant GH_Apply as GitHub Actions (Apply)
    participant State as S3 State
    participant AWS as AWS Infra

    Note over Dev,AWS: ─── Local Development ───
    Dev->>Local: terraform init -backend-config=env/dev/backend.hcl
    Local->>State: Pull dev state
    State-->>Local: Current dev state
    Dev->>Local: terraform plan -var-file=env/dev/terraform.tfvars
    Local->>Local: Compute diff against state
    Local-->>Dev: Show planned changes
    Dev->>Local: terraform apply -auto-approve
    Local->>Local: Acquire lock
    Local->>AWS: Create/update resources
    AWS-->>Local: Resource ARNs
    Local->>State: Write new state
    State-->>Local: Release lock
    Local-->>Dev: Apply complete

    Note over Dev,AWS: ─── Local → PR ───
    Dev->>Local: git push origin feature/x
    Note over Local,PR: Creates PR: feature/x → dev

    Note over Dev,AWS: ─── PR Review ───
    PR->>GH_Plan: Trigger terraform plan
    GH_Plan->>State: Pull dev state
    State-->>GH_Plan: Current state
    GH_Plan->>GH_Plan: terraform plan
    GH_Plan-->>PR: Comment with plan output
    Dev->>PR: Review plan, approve
    PR->>GH_Apply: Merge to dev branch

    Note over Dev,AWS: ─── Dev Auto-Apply ───
    GH_Apply->>State: Pull dev state
    GH_Apply->>AWS: terraform apply
    AWS-->>GH_Apply: Resources created/updated
    GH_Apply->>State: Write new state

    Note over Dev,AWS: ─── Dev → Staging Promotion ───
    Dev->>PR: Create PR: dev → staging
    PR->>GH_Plan: Plan against staging state
    GH_Plan-->>PR: Plan output
    Dev->>PR: Approve
    PR->>GH_Apply: Merge to staging
    GH_Apply->>AWS: Apply to staging environment
    AWS-->>GH_Apply: Staging resources

    Note over Dev,AWS: ─── Staging → Prod Promotion ───
    Dev->>PR: Create PR: staging → main
    PR->>GH_Plan: Plan against prod state
    GH_Plan-->>PR: Plan output
    Dev->>PR: Final approval
    PR->>GH_Apply: Merge to main
    GH_Apply->>AWS: Apply to production
    AWS-->>GH_Apply: Production resources

    Note over Dev,AWS: ─── Verification ───
    GH_Apply->>GH_Apply: terraform output
    GH_Apply-->>Dev: CloudFront URL, API endpoints
```

### Branch Strategy

```mermaid
gitGraph
    commit id: "init"
    branch dev
    checkout dev
    commit id: "feature/a"
    commit id: "feature/b"
    checkout main
    merge dev id: "PR → dev" tag: "auto-apply"
    branch staging
    checkout dev
    commit id: "feature/c"
    checkout staging
    merge dev id: "PR → staging" tag: "auto-apply"
    checkout main
    merge staging id: "PR → main (prod)" tag: "auto-apply"
```

1. **Feature branches** branch from `dev`
2. **PR to `dev`** — CI runs `terraform plan`, posts as PR comment
3. **Merge to `dev`** — CI runs `terraform apply` to dev environment
4. **PR from `dev` → `staging`** — Plan against staging, merge → apply
5. **PR from `staging` → `main`** — Plan against prod, merge → apply (requires approval gate)

---

## Cost Strategy

Terraform itself costs nothing (open source). The supporting infrastructure costs are negligible:

| Component | Service | Cost/Month | Notes |
|-----------|---------|-----------|-------|
| State storage | S3 Standard | ~$0.10 | Minimal data, versioning enabled |
| State locking | DynamoDB on-demand | ~$0.01 | Pay-per-request |
| CI/CD minutes | GitHub Actions (public repo) | **$0.00** | 2,000 min/mo free tier |
| CI/CD storage | GitHub Actions (public repo) | **$0.00** | 500 MB free tier |
| OIDC auth | AWS STS | **$0.00** | No charge for web identity tokens |
| **Total recurring** | | **~$0.11/mo** | |

For the **AWS resources** themselves, see [COSTS.md](./COSTS.md) for the full breakdown.

---

## Getting Started

### Prerequisites

- AWS account with AdministratorAccess (for bootstrap only)
- Terraform CLI ≥ 1.9.x installed locally
- GitHub repository with Actions enabled

### Bootstrap (One-Time)

These steps are performed **once** from a local machine with AWS credentials configured:

```bash
# 1. Create the S3 state bucket + DynamoDB lock table
cd terraform/bootstrap
terraform init
terraform apply -auto-approve

# 2. Create the OIDC provider + IAM role for GitHub Actions
terraform apply -auto-approve

# 3. Note the outputs
terraform output github_actions_role_arn
# → arn:aws:iam::123456789012:role/pprcv-gh-actions-dev
```

### Add as GitHub Secret

Store the AWS Account ID as a GitHub Actions secret:

| Secret Name | Value |
|-------------|-------|
| `AWS_ACCOUNT_ID` | `123456789012` |

No access keys or secret keys are stored — authentication uses OIDC.

### First Full Deploy

```bash
# From the terraform/ root
terraform init -backend-config="environments/dev/backend.hcl"
terraform plan -var-file="environments/dev/terraform.tfvars"
terraform apply -auto-approve
```

After the first deploy, all subsequent changes go through the **PR → plan → merge → apply** pipeline.

---

## Architecture Diagram (Full System)

For the complete system architecture including all AWS services and request flows, see [readme-arch-v1.md](readme-arch-v1.md).

This document covers the **infrastructure provisioning layer only** — the Terraform modules that define, deploy, and manage every resource in the PPCRV architecture.

---

## References

| Resource | Link |
|----------|------|
| Terraform AWS Provider | https://registry.terraform.io/providers/hashicorp/aws/latest |
| hashicorp/setup-terraform | https://github.com/hashicorp/setup-terraform |
| aws-actions/configure-aws-credentials | https://github.com/aws-actions/configure-aws-credentials |
| GitHub OIDC with AWS | https://docs.github.com/en/actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services |
| Terraform S3 Backend | https://developer.hashicorp.com/terraform/language/settings/backends/s3 |
| Full cost analysis | [COSTS.md](./COSTS.md) |
| Architecture overview | [readme-arch-v1.md](readme-arch-v1.md) |
| Change history | [CHANGES.md](./CHANGES.md) |
