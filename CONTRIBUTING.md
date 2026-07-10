# Contributing to Rasono

Rasono is being built as a framework, not as a loose collection of utilities.

This document explains the architectural philosophy contributors are expected to protect.

## Philosophy First

Before adding code, ask these questions:

- does this strengthen the framework, or only solve one local app problem?
- does this keep the core small?
- does this preserve adapter freedom?
- does this stay explicit instead of magical?
- does this keep Rasono neutral on transport, ORM, and database choices?

If the answer is unclear, the change probably needs to be redesigned before implementation.

## What Rasono Is

Rasono aims to be:

- explicit
- adapter-first
- modular
- production-oriented
- scalable without monolithic lock-in

Rasono is not trying to become:

- an ORM
- a one-size-fits-all meta-framework
- a transport monopoly
- a hidden dependency graph full of framework magic

## Repository Scope

Only framework assets should live in this repository:

- framework packages
- official adapters and providers
- official CLI and scaffolding
- official starters and templates
- framework tests
- documentation for users and contributors

Do not commit:

- temporary generated apps
- local scratch projects
- editor- or machine-specific artifacts
- experimental code that is not intended to become part of the framework

## Design Rules

### Small Core

Keep `@rasono/app` and other shared foundations intentionally narrow.

The core should own contracts, dependency injection, policies, lifecycle, and framework primitives.
It should not absorb provider-specific logic that belongs in dedicated packages.

### Adapter-First

Whenever possible:

- transport belongs in adapters
- data integrations belong in provider packages
- frontend integration belongs in adapters
- framework contracts belong in the core

Avoid changes that blur these boundaries.

### Explicit Over Magical

Prefer:

- explicit schemas
- explicit lifecycle
- explicit policies
- explicit transactions
- explicit configuration

Avoid behavior that is clever but hard to reason about under production conditions.

### Neutral Data Story

`@rasono/data` should stay framework-level and adapter-agnostic.

Official integrations such as:

- `@rasono/data-drizzle`
- `@rasono/data-kysely`
- `@rasono/data-engine`

should remain thin. They should expose native provider capabilities instead of hiding them behind a fake universal ORM.

## Quality Bar

Every meaningful contribution should aim to improve at least one of these:

- clarity
- consistency
- scalability
- maintainability
- security
- production readiness

Every meaningful contribution should also be validated with:

- `npm run build`
- `npm run typecheck`
- `npm run test`

If the change touches docs, scaffolding, or developer workflows, update the relevant markdown files and templates as part of the same change.

## Git Hygiene

Use branches with clear intent. Good examples:

- `main`
- `feat/data-prisma`
- `feat/starter-postgres`
- `fix/cli-prompts`
- `docs/framework-positioning`

Keep commits focused. A commit should represent one coherent framework change.

Do not mix:

- temporary artifacts
- local experiment outputs
- unrelated generated files
- non-framework assets

## Branch Strategy

Rasono does not use a random branch model.

Permanent branches:

- `main` for validated framework history
- `develop` for integration of upcoming framework work
- `release/<major>.<minor>.x` for release-line stabilization and patch maintenance

Short-lived branches should branch from `develop` unless the work is a release hotfix:

- `feat/<topic>`
- `fix/<topic>`
- `docs/<topic>`
- `refactor/<topic>`
- `chore/<topic>`

Examples:

- `feat/data-prisma`
- `fix/openapi-metadata`
- `docs/versioning-policy`

Release tags must be created from `main`.

## Versioning

Rasono uses Semantic Versioning:

- `MAJOR` for breaking framework changes
- `MINOR` for backward-compatible features
- `PATCH` for backward-compatible fixes

See [VERSIONING.md](./VERSIONING.md) for the formal repository policy.

## Documentation Standard

Documentation is part of the framework, not an afterthought.

When you add or change a feature:

- update user-facing documentation when behavior changes
- update contributor-facing documentation when architectural intent changes
- update `ENGINEERING_LOG.md` with the context, technical choices, and impact

## Final Check

Before opening a branch or pushing changes, verify:

- the repository contains only framework-relevant files
- generated temporary outputs are not staged
- the philosophy of the framework is still clear in the code and docs
- the change improves the framework as a platform, not just as a demo
