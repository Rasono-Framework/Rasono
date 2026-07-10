# Versioning and Branch Strategy

Rasono uses Semantic Versioning and a small branch model designed for framework work, not ad hoc application development.

## Semantic Versioning

Rasono follows:

- `MAJOR` for breaking framework changes
- `MINOR` for backward-compatible features
- `PATCH` for backward-compatible fixes

Examples:

- `0.1.0`
- `0.2.0`
- `0.2.3`
- `1.0.0`

As long as Rasono is pre-`1.0.0`, the framework is still stabilizing. That does **not** mean changes should be casual. Breaking changes must still be deliberate, documented, and justified.

## Tags

Every release should be represented by an annotated Git tag:

- `v0.1.0`
- `v0.1.1`
- `v0.2.0`

Tags are the source of truth for framework releases.

## Branch Model

Rasono uses a simple professional model:

- `main`
  - production-ready history
  - only validated framework changes
  - every release tag comes from here
- `develop`
  - integration branch for upcoming framework work
  - feature branches merge here first when needed
- `release/<major>.<minor>.x`
  - stabilization branch for a release line
  - used for release preparation and patch backports

Short-lived working branches should use explicit names:

- `feat/<topic>`
- `fix/<topic>`
- `docs/<topic>`
- `refactor/<topic>`
- `chore/<topic>`

Examples:

- `feat/data-prisma`
- `feat/starter-postgres`
- `fix/cli-guided-prompts`
- `docs/framework-philosophy`

## Merge Expectations

- Merge feature work into `develop`
- Promote validated release candidates from `develop` to `main`
- Create `release/<major>.<minor>.x` when a release line needs stabilization or patch maintenance
- Tag releases on `main`

## Protection Recommendations

For GitHub branch protection, use these minimum rules:

- protect `main`
- protect `develop`
- require pull requests
- require passing CI
- block force pushes
- block direct deletion

## Release Checklist

Before cutting a release:

1. run `npm run build`
2. run `npm run typecheck`
3. run `npm run test`
4. update docs if public behavior changed
5. update `ENGINEERING_LOG.md`
6. ensure `main` contains only framework-relevant changes
7. create an annotated tag such as `v0.1.0`

## Current Baseline

- framework repository version: `0.1.0`
- initial release tag: `v0.1.0`
- active permanent branches: `main`, `develop`, `release/0.1.x`
