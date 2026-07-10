# Rasono

Rasono is a FastAPI-inspired TypeScript framework for teams that want explicit APIs, adapter freedom, and production-grade structure without buying into a monolithic platform.

It is built around one simple idea:

> The framework should give you strong conventions, not hidden lock-in.

Rasono combines:

- a small application core
- explicit dependency injection
- transport adapters instead of transport ownership
- request-scoped data primitives instead of a framework-owned ORM
- a CLI that can scaffold only what a team actually wants to install

## Why Rasono Exists

Most TypeScript backend stacks force an uncomfortable trade-off:

- some are productive, but too magical once the system grows
- some are flexible, but leave architecture entirely up to the team
- some are full-stack, but couple your backend choices to one frontend or one hosting model
- some are fast to start, but hard to keep clean at scale

Rasono is designed to sit in the middle:

- as explicit as a serious backend framework
- as modular as a toolkit
- as scalable as an adapter-first architecture should be
- as pragmatic as teams shipping real systems in production

## Core Philosophy

### 1. Small Core, Strong Contracts

`@rasono/app` stays intentionally small.

The core owns:

- route contracts
- schema boundaries
- dependency injection
- policies
- lifecycle
- error mapping

The core does **not** own your transport, your ORM, or your database vendor.

### 2. Adapter-First by Design

Hono is an adapter, not the framework.
Rasengan is an adapter path, not the framework.
Your data provider is an adapter, not the framework.

That matters because real systems evolve:

- HTTP adapters change
- frontend stacks change
- database strategy changes
- deployment targets change

Rasono is built so those changes do not force a rewrite of your application core.

### 3. Explicit Over Magical

Rasono favors explicit behavior over implicit framework magic:

- explicit schemas
- explicit auth
- explicit policies
- explicit transactions
- explicit idempotency and outbox primitives
- explicit module boundaries

That makes small projects easier to reason about and large projects easier to keep honest.

### 4. Neutral on ORM and Database

Rasono has an official data story, but it does not try to become an ORM.

The model is:

- `@rasono/data` for framework-level data primitives
- `@rasono/data-drizzle` for Drizzle
- `@rasono/data-kysely` for Kysely
- `@rasono/data-engine` as an optional proprietary provider

This keeps PostgreSQL, MySQL, SQLite, Turso, and future providers as first-class choices.

## What Rasono Does Better

### Compared to Backend Toolkits

Rasono gives you more structure than a loose Hono or Express stack:

- official module conventions
- official policy model
- official OpenAPI generation
- official RPC generation
- official request-scoped data primitives

You do not have to invent the architecture every time.

### Compared to Heavy Frameworks

Rasono gives you less lock-in than monolithic frameworks:

- transport is replaceable
- data layer is replaceable
- web layer is replaceable
- optional packages stay optional

You keep control of your platform decisions.

### Compared to Full-Stack Meta-Frameworks

Rasono keeps the backend as a first-class system:

- APIs are explicit
- auth and policies are explicit
- lifecycle is explicit
- data boundaries are explicit

It does not assume your backend is only a side effect of your frontend.

## Built for Real Systems

Rasono is designed to scale from:

- a small landing page with an API
- a CRUD product with generated RPC
- a serious service with policies and request-scoped dependencies
- a platform with multiple adapters, multiple modules, and high request volume

The current direction already includes:

- request-scoped DI
- composable auth resolvers
- reusable authorization policies
- tenant-aware primitives
- OpenAPI generation
- RPC generation
- official data providers
- idempotency and outbox primitives for critical write flows

## Package Model

The framework is modular on purpose.

Core packages:

- `@rasono/app`
- `@rasono/hono`
- `@rasono/auth`
- `@rasono/swagger`
- `@rasono/actions`
- `@rasono/web-core`
- `@rasono/data`
- `@rasono/data-drizzle`
- `@rasono/data-kysely`
- `@rasono/data-engine`
- `@rasono/cli`
- `create-rasono`

The rule is simple:

install what you use, and do not pay for what you do not use.

## Quick Start

### Guided CLI

```bash
npm --workspace create-rasono run build
node packages/create-rasono/dist/index.js
```

The CLI can guide setup step by step in English:

- target directory
- package manager
- starter preset
- Web/API/features
- data provider and database
- dependency installation

### Flags-First CLI

```bash
node packages/create-rasono/dist/index.js my-app \
  --preset=api-only \
  --pm=npm \
  --api \
  --no-web \
  --swagger \
  --no-actions \
  --no-rpc \
  --data=kysely \
  --database=postgres \
  --no-install \
  --yes
```

## Who Rasono Is For

Rasono is a strong fit if you want:

- FastAPI-like explicitness in TypeScript
- a backend that remains clean after the prototype phase
- a framework that does not force one ORM or one database
- a stack that can start small and grow into a serious platform
- conventions that help without swallowing architecture ownership

Rasono is **not** trying to be:

- another ORM
- another everything-included meta-framework
- another magic-heavy abstraction layer

It is trying to be the framework you can still trust once your codebase becomes important.

## Positioning

Rasono is for teams that want:

- the clarity of FastAPI
- the modularity of the TypeScript ecosystem
- the replaceability of adapters
- the discipline of explicit contracts
- the ability to build a product, not just a demo

## Contributor Philosophy

Rasono is not meant to grow like a random TypeScript monorepo.

Every contributor should protect the framework's architectural identity:

- keep the core small
- prefer adapters over ownership
- prefer explicit contracts over hidden magic
- keep data integrations thin and provider-specific
- never turn Rasono into an ORM, a transport monopoly, or a kitchen-sink platform
- add features only when they strengthen the framework model, not just one application use case

Contributors should assume that every new package, API, or abstraction will affect:

- long-term maintainability
- runtime predictability
- framework neutrality
- operational complexity
- contributor ergonomics

The question is not only "does this work?"

The real question is:

> does this make Rasono a better framework?

### What Should Be In This Repository

This repository should contain framework assets only:

- core packages
- official adapters
- official tooling
- official starters
- tests, documentation, and contributor guidance

It should not accumulate local experiments, temporary app outputs, machine-specific artifacts, or unrelated product code.

### Contribution Standard

Good contributions to Rasono usually have these properties:

- they strengthen an existing contract instead of adding framework magic
- they improve scalability, maintainability, or clarity
- they preserve replaceability of adapters and providers
- they keep defaults safe and explicit
- they come with validation through build, typecheck, and targeted tests

If a change adds complexity, it should earn that complexity by making the framework more coherent, not less.

## Status

Rasono is actively being shaped into a framework-grade platform.

The direction is deliberate:

- make the core credible
- make production choices first-class
- keep the architecture scalable
- keep the core small
- keep optional packages optional

If that philosophy matches how you build systems, Rasono is the project to watch and contribute to.

For contribution workflow and repository rules, see [CONTRIBUTING.md](./CONTRIBUTING.md).
