# PR Review CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that runs `turbo build`, `turbo test`, and an AI code review using OpenCode DeepSeek V4 Flash on every PR.

**Architecture:** Three parallel jobs (build, test, review) defined in a single workflow file under `.github/workflows/`. No gate/blocking job — checks report independently. PR branch protection rules are configured separately in GitHub repo settings.

**Tech Stack:** GitHub Actions, pnpm/Turborepo, NestJS, Next.js, `anomalyco/opencode/github@v1.17.8`, DeepSeek V4 Flash

## Global Constraints

- Workflow triggers on: `pull_request` types `[opened, synchronize, reopened, ready_for_review]`
- Concurrency: group by PR number, cancel-in-progress
- All jobs run on `ubuntu-latest`
- Node version: 20
- Package manager: pnpm with `--frozen-lockfile`
- Build command: `pnpm build` (runs `turbo build`)
- Test command: `pnpm test` (runs `turbo test` — API Jest only)
- Review action: `anomalyco/opencode/github@v1.17.8`
- Model: `opencode/deepseek-v4-flash-free`
- Review guard: skip if PR is from fork
- Review permissions: `id-token: write`, `contents: read`, `pull-requests: write`, `issues: write`
- Secret required: `OPENCODE_API_KEY`

---

### Task 1: Create PR review workflow

**Files:**
- Create: `.github/workflows/opencode-review.yml`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: the workflow definition

- [ ] **Step 1: Create `.github/workflows/opencode-review.yml`**

```yaml
name: PR Checks
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  review:
    if: github.event.pull_request.head.repo.fork == false
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      id-token: write
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false

      - name: AI Code Review
        uses: anomalyco/opencode/github@v1.17.8
        env:
          OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          model: opencode/deepseek-v4-flash-free
          use_github_token: true
          diff_context: 5
          max_files: 80
          prompt: |
            Review this pull request.

            Read the diff and changed files. Check for:
            - Bugs and logic errors
            - Security vulnerabilities
            - Missing error handling

            Be conservative — only flag things you're 90%+ sure about.
            Skip style, formatting, and naming nits.
            If the code looks good, say LGTM.
            Write findings as a PR review with file:line references.
```

- [ ] **Step 2: Verify workflow syntax**

GitHub Actions YAML has no local validator. Push to a branch and open a PR — GitHub will parse the workflow and show errors in the Actions tab if any exist.

Expected: Workflow appears in the Actions tab as "PR Checks" with 3 jobs (build, test, review) when a PR is opened.

- [ ] **Step 3: Add and commit**

```bash
mkdir -p .github/workflows
# (file already written above)
git add .github/workflows/opencode-review.yml
git commit -m "ci: add PR review workflow with build, test, and AI review"
```

### Post-Implementation

After deploying, the user must add the `OPENCODE_API_KEY` secret to the GitHub repository:
1. Go to repo Settings → Secrets and variables → Actions
2. Add `OPENCODE_API_KEY` with the DeepSeek API key
3. Open a test PR to verify all 3 jobs run and the AI review posts a comment
