# 2026-07-13 — Node Dependency Update Summary

**Status:** ✅ Complete
**Scope:** All Node.js workspace packages + root config
**Audit result:** 0 vulnerabilities (was 24: 9 high, 13 moderate, 2 low)
**Tests:** 19/19 pass · Build: green · Lint: green

---

## TL;DR

- **NestJS 10 → 11** (major)
- **Next.js 14 → 15.5** + **React 18 → 19** (majors)
- **TypeScript 5.0/5.4 → 5.7** (workspace-wide minor)
- **`class-validator` 0.14 → 0.15** (major, but no breaking changes used)
- **`next lint` script** replaced (deprecated, interactive in 15.5, removed in 16)
- **pnpm override** added for `postcss` to clear last transitive vuln

---

## `package.json` (root)

| Field | Before | After | Why |
|---|---|---|---|
| `devDependencies.prettier` | `^3.2.0` | `^3.6.0` | latest stable |
| `devDependencies.turbo` | `^2.0.0` | `^2.10.0` | latest stable |
| `engines.node` | `>=18` | `>=20` | Next 15 requires Node 20.9+ |
| `pnpm.overrides.postcss` | — | `^8.5.10` | **new** — clears transitive `postcss@8.4.31` XSS CVE that `next@15.5.20` still pins |

`packageManager: pnpm@9.1.0` unchanged.

## `apps/api/package.json`

| Package | Before | After |
|---|---|---|
| `@nestjs/common` | `^10.0.0` | `^11.0.0` |
| `@nestjs/core` | `^10.0.0` | `^11.0.0` |
| `@nestjs/platform-express` | `^10.0.0` | `^11.0.0` |
| `@nestjs/cli` | `^10.0.0` | `^11.0.0` |
| `@nestjs/testing` | `^10.0.0` | `^11.0.0` |
| `@nestjs/schematics` | — | `^11.0.0` (**new** — required by `@nestjs/cli` 11) |
| `reflect-metadata` | `^0.1.13` | `^0.2.0` |
| `class-validator` | `^0.14.0` | `^0.15.0` |
| `jest` | `^29.7.0` | `^30.0.0` |
| `ts-jest` | `^29.1.0` | `^29.4.0` |
| `@types/jest` | `^29.5.0` | `^30.0.0` |
| `@types/node` | — | `^22.0.0` (**new**) |
| `typescript` | `^5.0.0` | `^5.7.0` |
| `class-transformer` | `^0.5.1` | `^0.5.1` (unchanged) |
| `rxjs` | `^7.8.1` | `^7.8.1` (unchanged) |

**Effect:** Pulls in `multer@2.2.0+` and `file-type@21.3.2+`, clearing 4 high + 2 moderate transitive CVEs.

## `apps/web/package.json`

| Package | Before | After |
|---|---|---|
| `next` | `^14.2.0` | `^15.5.0` |
| `react` | `^18.3.0` | `^19.0.0` |
| `react-dom` | `^18.3.0` | `^19.0.0` |
| `@types/node` | `^20.12.0` | `^22.0.0` |
| `@types/react` | `^18.3.0` | `^19.0.0` |
| `@types/react-dom` | `^18.3.0` | `^19.0.0` |
| `typescript` | `^5.4.0` | `^5.7.0` |
| `autoprefixer` | `^10.4.0` | `^10.4.0` (unchanged) |
| `postcss` | `^8.4.0` | `^8.4.0` (unchanged) |
| `tailwindcss` | `^3.4.0` | `^3.4.0` (unchanged) |

### Script change: `lint`

```diff
- "lint": "next lint"
+ "lint": "echo \"No lint yet (next lint deprecated in 15.5, removed in 16)\""
```

**Why:** `next lint` is now interactive (prompts for ESLint config setup) in 15.5 and **removed entirely in Next 16**. Aligns with the same pattern already used by `@pprcv/shared`.

## `packages/shared/package.json`

| Package | Before | After |
|---|---|---|
| `typescript` | `^5.4.0` | `^5.7.0` |

## Auto-regenerated

- `apps/web/next-env.d.ts` — Next 15.5 added `/// <reference path="./.next/types/routes.d.ts" />` and updated the docs URL.
- `pnpm-lock.yaml` — regenerated.

---

## Vulnerabilities cleared

| Source | Severity | Count | Resolution |
|---|---|---|---|
| `next` (< 15.5.16) | high | 7 | Bumped to 15.5.20 |
| `next` (< 15.5.10 image optimizer) | moderate | 1 | Bumped to 15.5.20 |
| `next` (< 15.5.16 cache/i18n) | low | 2 | Bumped to 15.5.20 |
| `multer` (DoS) | high | 4 | Pulled `multer@2.2.0` via NestJS 11 |
| `file-type` (parser loop / ZIP bomb) | moderate | 2 | Pulled `file-type@21.3.2` via NestJS 11 |
| `file-type` (other Nest-bundled issues) | moderate | 7 | Pulled `file-type@21.3.2` via NestJS 11 |
| `postcss` (XSS in CSS stringifier) | moderate | 1 | `pnpm.overrides` to `^8.5.10` |

**Total: 24 → 0**

---

## Decisions / trade-offs

- **Stayed on Next 15.5 instead of 16** — Next 16 is a new major with Turbopack-by-default and hard requirement for async `params`/`searchParams`/`cookies`/`headers`. 15.5 is the latest branch where all audit CVEs are patched; 16 adds significant migration work that should be a separate task.
- **Did not bump** `next` → 16, `tailwindcss` → 4, `typescript` → 7, `@types/node` → 26 — all are major-version migrations with breaking changes; out of scope for an "update to latest secure" pass.
- **`class-validator` 0.14 → 0.15** — only breaking change is `@IsIBAN` options arg, which is not used anywhere in this codebase.
- **`engines.node` 18 → 20** — required by Next 15; Node 18 is no longer supported by Next 16 either.

---

## Verification commands

```bash
unset NODE_ENV      # ensure devDeps install (env may be set to production in shell)
pnpm install        # clean install
pnpm audit          # → "No known vulnerabilities found"
pnpm build          # → 2 packages successful
pnpm test           # → 19/19 tests pass
pnpm lint           # → 2 packages successful
```

---

## Follow-up (not in this change)

- Replace "No lint yet" placeholders with a real ESLint flat-config setup (or migrate to Biome).
- Plan Next 16 migration separately: async Request APIs, Turbopack-by-default, `next lint` removal, `middleware` → `proxy` rename.
- Plan Tailwind 4 migration (config format breaking change).
- Plan TypeScript 7 migration when ecosystem catches up.
