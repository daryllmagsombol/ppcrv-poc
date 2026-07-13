# PR Review CI — GitHub Actions + OpenCode DeepSeek V4 Flash

## Overview

Add a GitHub Actions workflow that automatically reviews pull requests using OpenCode with the DeepSeek V4 Flash model. The workflow runs build and test checks in parallel with an AI code review, posting results directly as PR review comments.

## Triggers

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
```

- Runs on PR creation, new commits, reopening, and moving from draft to ready.
- Concurrency group per PR number, cancel-in-progress on new pushes.

## Jobs

### 1. `build`

| Field | Value |
|-------|-------|
| Runs on | `ubuntu-latest` |
| Timeout | 5 minutes |
| Steps | `checkout` → `pnpm/action-setup` → `setup-node` (20, cache pnpm) → `pnpm install --frozen-lockfile` → `pnpm build` |
| Command | `pnpm build` (runs `turbo build` which triggers `nest build` + `next build`) |

### 2. `test`

| Field | Value |
|-------|-------|
| Runs on | `ubuntu-latest` |
| Timeout | 5 minutes |
| Depends on | `build` (implicit via turbo.json, but runs in parallel in workflow) |
| Steps | Same setup as `build` → `pnpm test` |
| Command | `pnpm test` (runs `turbo test` which runs API Jest tests, ETL Pytest) |
| Notes | `turbo test` depends on `build` in `turbo.json`, so Turbo orchestrates ordering even though the GitHub jobs are parallel. Currently only runs API Jest tests (19); ETL Pytest not yet wired into Turbo |

### 3. `review`

| Field | Value |
|-------|-------|
| Runs on | `ubuntu-latest` |
| Timeout | 10 minutes |
| Permissions | `id-token: write`, `contents: read`, `pull-requests: write`, `issues: write` |
| Guard | Skips if PR is from a fork (`github.event.pull_request.head.repo.fork == false`) |
| Action | `anomalyco/opencode/github@v1.17.8` |
| Model | `opencode/deepseek-v4-flash-free` |
| Config | `use_github_token: true`, `diff_context: 5`, `max_files: 80` |

**Prompt:**
```
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

**Environment variables:**
- `OPENCODE_API_KEY` — from `secrets.OPENCODE_API_KEY`
- `GITHUB_TOKEN` — from `secrets.GITHUB_TOKEN`

## Secrets Required

| Secret | Purpose |
|--------|---------|
| `OPENCODE_API_KEY` | API key for DeepSeek model access |
| `GITHUB_TOKEN` | Default GitHub token (auto-provided, needs explicit pass) |

## Dependencies

- `anomalyco/opencode/github@v1.17.8` — GitHub Action wrapper for OpenCode
- `actions/checkout@v4`
- `pnpm/action-setup@v4`
- `actions/setup-node@v4`

## Files Created

- `.github/workflows/opencode-review.yml` — the workflow definition

## What It Does Not Do

- No gate/blocking job — the three checks run independently and report their status. PR branch protection rules (required status checks) are configured separately in the GitHub repo settings.
- No ETL test CI — ETL Pytest (`tests/`) is not wired into `turbo test` yet. Only API Jest tests run.

## Open Items

1. Wire ETL Pytest into `turbo test` or add a separate CI job
2. Customize the review prompt per-stack once team has experience with the generic prompt
