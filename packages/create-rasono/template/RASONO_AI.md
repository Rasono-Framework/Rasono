---
name: "rasono-ai"
purpose: "Guide IA pour développer un projet Rasono (Rasengan + Hono) façon FastAPI: rapide, scalable, sécurisé, et léger."
---

# Rasono — Guide IA (Rasengan + Hono, philosophie FastAPI)

## Contexte (à conserver)

- Monorepo “apps” :
  - `apps/web` : UI avec Rasengan (SSR/SSG/SPA)
  - `apps/api` : API avec Hono + primitives Rasono (DI, erreurs, rate limit, background tasks)
- But : ergonomie “FastAPI” en TypeScript, sans lourdeur (démarrage + install rapides).

## Objectifs non-négociables

- Légèreté : pas de dépendances “magiques” si non nécessaires (préférer Node/Web APIs).
- Complexité : toute feature middleware doit être O(1) par requête (ou amortie O(1)).
- Sécurité : défauts sûrs (trustProxy désactivé, pas d’exfiltration via logs, pas d’erreurs internes exposées).
- DX : erreurs propres et actionnables (requestId, status, message).
- Modularité : installer uniquement les packages utiles au projet; aucune feature optionnelle ne doit imposer l'installation du reste.

## Packages modulaires

- `@rasono/app`
  - Façade API principale pour `createApp()`, `defineRoute()`/`defineApi()`, `defineSchema()`, `defineDep()`, `defineErrors()`, `definePolicy()`, `composePolicies()`, `httpError()` et les primitives d'erreur courantes.
- `@rasono/hono`
  - Adapter HTTP Hono optionnel. À installer si tu veux exécuter ton app Rasono sur Hono aujourd'hui, mais le cœur `@rasono/app` reste découplé du transport.
- `@rasono/actions`
  - À installer seulement si le projet expose des server actions ou consomme `createServerActionClient()`.
- `@rasono/swagger`
  - À installer seulement si le projet publie Swagger UI ou la doc HTTP intégrée.
- `@rasono/auth`
  - Helpers d'auth adapter-agnostic pour composer des resolvers `bearer`, `apiKey` et des stratégies mixtes sans dépendre du transport HTTP.
- `@rasono/web-core`
  - Contrats Web partagés: client HTTP/RPC générique et helpers d'adapter UI, sans dépendre d'un framework frontend précis.
- `@rasono/web-memory`
  - Adapter Web minimal sans framework UI externe, utile pour prouver la remplaçabilité de Rasengan ou pour des tests/outils internes.
- `@rasono/rasengan`
  - Compatibilité/exemples d'intégration historiques autour de Rasengan; le starter Web moderne s'appuie surtout sur `rasengan` + `@rasono/web-core`.
- `@rasono/testing`
  - À installer pour les tests d'intégration Rasono avec `createTestApp()` et un client HTTP léger sur `app.fetch`.
- `@rasono/core`
  - Optionnel pour les usages avancés: `Result`, `Schema`, erreurs partagées hors façade `@rasono/app`.
- `@rasono/data`
  - Couche data officielle et adapter-agnostic pour les sessions request-scoped, les transactions et le wiring des repositories.
- `@rasono/data-drizzle`
  - Premier provider officiel fin pour intégrer Drizzle sans masquer son API native de transaction.
- `@rasono/data-kysely`
  - Provider officiel fin pour Kysely, utile quand tu veux une story multi-base forte avec PostgreSQL, MySQL, SQLite, MSSQL ou un dialecte custom.
- `@rasono/data-engine`
  - Provider officiel proprietaire et optionnel pour la stack Engine de Rasono; utile pour Turso, mais jamais requis pour utiliser PostgreSQL, MySQL, SQLite, Prisma, Drizzle, Kysely ou un autre provider.

## Profils d'installation minimaux

- API minimale :
  - `@rasono/app`
  - `@rasono/cli`
  - `@rasono/hono`
  - `hono`
  - `@hono/node-server`
- API + server actions :
  - API minimale
  - `@rasono/actions`
- API + tests d'intégration :
  - API minimale
  - `@rasono/testing`
- API + doc Swagger :
  - API minimale
  - `@rasono/swagger`
- API + auth modulaire :
  - API minimale
  - `@rasono/auth`
  - Variables d'env de référence: `RASONO_ADMIN_BEARER_TOKEN`, `RASONO_SERVICE_API_KEY`, `RASONO_SESSION_TOKEN`
- API + couche data officielle :
  - API minimale
  - `@rasono/data`
- API + couche data Drizzle :
  - API + couche data officielle
  - `@rasono/data-drizzle`
- API + couche data Kysely :
  - API + couche data officielle
  - `@rasono/data-kysely`
- API + couche data Engine :
  - API + couche data officielle
  - `@rasono/data-engine`
- Web minimale :
  - `@rasono/web-core`
  - `@rasono/cli`
  - `rasengan`
  - `react`
  - `react-dom`
- Web alternatif minimal :
  - `@rasono/web-core`
  - `@rasono/web-memory`
- Web + appels server actions :
  - Web minimale
  - `@rasono/actions`

## Règle d'architecture

- `@rasono/app` ne doit pas dépendre directement d'un transport HTTP ou d'un framework UI.
- Le backend choisit un adapter via `transport: { adapter, options }`.
- Le frontend choisit un helper générique via `@rasono/web-core` et encapsule le framework UI réel dans un adapter local.
- Remplacer Hono, Rasengan ou un autre adapter ne doit pas forcer une refonte du cœur métier, des routes déclaratives ou de la DI.

## Commandes (choisis ton package manager)

### Web (Rasengan)

- npm : `npm --workspace apps/web run dev`
- pnpm : `pnpm -C apps/web dev`
- bun : `bun --cwd apps/web dev`

Le script `dev` Web utilise `rasono dev` :

- génération initiale du manifest des pages
- génération initiale du client RPC généré
- watch de `src/app/**.page.tsx`
- régénération automatique de `src/.rasono/pages.generated.ts`
- régénération automatique de `src/.rasono/rpc.generated.ts`
- lancement de `rasengan dev`

### API (Hono)

- npm : `npm --workspace apps/api run dev`
- pnpm : `pnpm -C apps/api dev`
- bun : `bun --cwd apps/api dev`

Le script `dev` API utilise `rasono dev` :

- génération initiale du manifest API
- génération initiale du manifest des server actions
- watch de `src/api/**`
- watch de `src/modules/**/api/**`
- watch de `src/actions/**`
- régénération automatique de `src/.rasono/api.generated.ts`
- régénération automatique de `src/.rasono/actions.generated.ts`
- lancement de `tsx watch src/index.ts`

## Conventions Rasono (à respecter)

### 1) Frontière de confiance

- Tout ce qui vient du client est hostile : body/query/params/headers.
- Toute authN/authZ doit être explicitement vérifiée (middleware + use-case).
- Les erreurs internes ne doivent jamais exposer de détails (stack, SQL, secrets).

### 2) Architecture (style FastAPI)

- `apps/api` :
  - routes = parsing + validation + mapping d’erreurs
  - use-cases/services = logique applicative
  - repos/gateways = accès DB/externe (interfaces)
  - DI = dépendances injectées, pas de singletons globaux cachés
  - background tasks = tâches non-bloquantes déclenchées après la réponse

### 4) DI et lifecycle

- Préfère `defineDep()` avec `scope: 'singleton' | 'request' | 'transient'` pour les services construits par le framework.
- `createApp()` accepte `dependencies` pour les providers, `startup()` pour l'initialisation applicative et `shutdown()` pour la fermeture propre.
- `createApp()` accepte aussi `overrides` pour injecter des doubles de test ou des implémentations spécifiques à un environnement contrôlé.
- Les handlers lisent les dépendances résolues depuis `ctx.deps` ou via l'argument `deps` de `defineRoute()`.
- Les dépendances `request` sont nettoyées automatiquement en fin de requête; les dépendances `singleton` sont libérées lors de `app.close()`.

### 4.1) Data layer officielle

- Utilise `@rasono/data` pour garder une story data officielle sans coupler le framework à un ORM précis.
- Les providers ORM doivent rester dans des packages dédiés (`@rasono/data-drizzle`, `@rasono/data-kysely`, `@rasono/data-engine`, plus tard `@rasono/data-prisma`) et ne jamais cacher l'API native de l'outil sous-jacent.
- `@rasono/data-engine` est un provider officiel optionnel, pas le centre de gravite du framework. Le centre de gravite reste `@rasono/data` + tes providers de choix.
- PostgreSQL doit etre un citoyen de premiere classe du framework au meme titre que Turso, MySQL ou SQLite.
- Les sessions DB doivent être `request-scoped`.
- Les transactions doivent être explicites via `withTransaction(...)`.
- Les repositories doivent dépendre de la session injectée, pas d'un singleton global caché.
- Le coût de cette abstraction doit rester hors hot path de parsing HTTP et ne pas ajouter de magie runtime inutile.
- Pour des flux critiques de type finance, garde les transactions courtes, évite toute I/O externe dans la transaction, privilégie une isolation stricte quand le provider le permet, et rends les effets externes idempotents via outbox ou équivalent.
- Pour les commandes mutantes exposées publiquement, utilise une clé d'idempotence liée à un fingerprint de payload stable; un même key avec un payload différent doit être traité comme un conflit et jamais rejoué silencieusement.
- N'ajoute pas de retry automatique au niveau framework pour les écritures critiques: le retry doit rester explicite au niveau use-case, avec garanties d'idempotence et stratégie métier claire.

```ts
import { createDataSessionDep, createRepositoryDep, defineDataAdapter } from '@rasono/data'

const dbAdapter = defineDataAdapter({
  name: 'memory-db',
  openSession: async () => ({ log: [] as string[] }),
  beginTransaction: async (session) => ({ session }),
  commitTransaction: async () => {},
  rollbackTransaction: async () => {},
})

const dependencies = {
  db: createDataSessionDep(dbAdapter),
  usersRepository: createRepositoryDep({
    sessionKey: 'db',
    create: ({ session }) => ({
      createUser: (name: string) =>
        session.withTransaction(async ({ session: raw }) => {
          raw.log.push(`insert:${name}`)
          return { name }
        }),
    }),
  }),
}
```

```ts
import { createDrizzleDataAdapter } from '@rasono/data-drizzle'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

const db = drizzle({ client: pool })

const drizzleAdapter = createDrizzleDataAdapter({
  client: db,
  transactionOptions: {
    isolationLevel: 'serializable',
  },
})
```

```ts
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createKyselyDataAdapter } from '@rasono/data-kysely'

type Database = {
  users: {
    id: number
    email: string
  }
}

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.DATABASE_URL,
    }),
  }),
})

const kyselyAdapter = createKyselyDataAdapter({
  client: db,
  isolationLevel: 'serializable',
})
```

```ts
import { createEngineClientFactory, createEngineDataAdapter } from '@rasono/data-engine'
import { createClient } from '@libsql/client'

const engineAdapter = createEngineDataAdapter({
  client: createEngineClientFactory(createClient, {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
  transactionMode: 'write',
})
```

```ts
import {
  defineIdempotencyStore,
  defineOutboxStore,
  drainOutboxMessages,
  executeIdempotentOperation,
} from '@rasono/data'

const paymentsIdempotencyStore = defineIdempotencyStore({
  begin: async ({ key, fingerprint }) => {
    // Persist a single row keyed by the logical command.
    return { kind: 'started', record: { key, fingerprint, state: 'in_progress' } }
  },
  complete: async ({ key, fingerprint, response }) => ({
    key,
    fingerprint,
    state: 'completed',
    response,
  }),
  fail: async ({ key, fingerprint, error }) => ({
    key,
    fingerprint,
    state: 'failed',
    error,
  }),
})

const outcome = await executeIdempotentOperation({
  store: paymentsIdempotencyStore,
  key: idempotencyKey,
  fingerprint: requestFingerprint,
  execute: async () => paymentService.authorize(command),
})

if (outcome.kind === 'replayed') {
  return outcome.result
}

if (outcome.kind === 'conflict') {
  throw new Error('Idempotency conflict')
}
```

```ts
const outboxStore = defineOutboxStore({
  enqueue: async (message) => {
    // Insert the outbox row in the same database transaction as the aggregate write.
  },
  lease: async ({ consumer, limit }) => [],
  acknowledge: async ({ consumer, message }) => {},
  release: async ({ consumer, message, error, retryAt }) => {},
})

await drainOutboxMessages({
  store: outboxStore,
  consumer: 'billing-worker',
  limit: 100,
  handle: async (message) => billingPublisher.publish(message),
})
```

### 5) Principal et auth

- Utilise `resolvePrincipal()` dans `createApp()` pour transformer la requête entrante en `principal` officiel Rasono.
- `defineRoute({ auth: { required: true, roles: [...] } })` s'appuie ensuite sur `ctx.principal` pour la vérification d'accès de base.
- Garde la logique d'authN dans `resolvePrincipal()` et la logique d'authZ fine dans les use-cases/policies.
- Utilise `definePolicy()` pour les règles fines d'autorisation et `composePolicies()` pour chaîner plusieurs checks sans middleware implicite.
- Si ton application est multi-tenant, ajoute `tenantId` au `principal` et fais passer l'isolation inter-tenant par des policies explicites.
- Utilise `input.cookies` pour valider explicitement les cookies nécessaires.
- Utilise `response: { status, description, contentType, schema }` pour rendre les réponses HTTP explicites et bien documentées.
- Utilise `openapi` sur `defineRoute()` pour enrichir les descriptions de paramètres, les exemples, le request body et les `externalDocs`.
- Le starter API de référence branche trois stratégies sans couplage transport: `bearer`, `apiKey` et `session cookie`.

```ts
import { composePolicies, createApp, definePolicy } from '@rasono/app'
import { createHonoAdapter } from '@rasono/hono'
import { composePrincipalResolvers, createApiKeyPrincipalResolver, createBearerPrincipalResolver, createSessionPrincipalResolver } from '@rasono/auth'

const app = createApp({
  deps: { users: userService, integrations: integrationService },
  transport: {
    adapter: createHonoAdapter(),
  },
  resolvePrincipal: composePrincipalResolvers([
    createBearerPrincipalResolver({
      verifyToken: (token, { deps }) => deps?.users.verifyBearerToken(token),
    }),
    createApiKeyPrincipalResolver({
      verifyKey: (apiKey, { deps }) => deps?.integrations.verifyApiKey(apiKey),
    }),
    createSessionPrincipalResolver({
      cookieName: 'session',
      verifySession: (sessionToken, { deps }) => deps?.users.verifySessionToken(sessionToken),
    }),
  ]),
})
```

```ts
import { composePolicies, definePolicy, defineRoute } from '@rasono/app'

const requireSameOwner = definePolicy(({ principal, input }) => {
  return principal?.sub === input.query?.ownerId
})

const requireUserRole = definePolicy(({ principal }) => {
  return (principal?.roles ?? []).includes('user')
})

export default defineRoute({
  method: 'get',
  auth: { required: true },
  policy: composePolicies([requireUserRole, requireSameOwner]),
  handler: (_c, { principal }) => ({ owner: principal?.sub }),
})
```

```ts
export default defineRoute({
  method: 'post',
  openapi: {
    query: {
      expand: {
        description: 'Optional relation expansion',
        example: 'owner',
      },
    },
    requestBody: {
      description: 'Widget creation payload',
      examples: {
        default: {
          summary: 'Widget payload',
          value: { name: 'Demo widget' },
        },
      },
    },
    externalDocs: {
      description: 'Widget API guide',
      url: 'https://example.test/docs/widgets',
    },
  },
  response: {
    status: 201,
    description: 'Widget created',
    examples: {
      created: {
        summary: 'Created widget',
        value: { id: 'wid_123' },
      },
    },
  },
  handler: async () => ({ id: 'wid_123' }),
})
```

```ts
import { composePolicies, definePolicy, defineRoute } from '@rasono/app'

const requireSameTenant = definePolicy(({ principal, input }) => {
  return principal?.tenantId === input.query?.tenantId
})

export default defineRoute({
  method: 'get',
  auth: { required: true },
  policy: composePolicies([requireSameTenant]),
  handler: (_c, { principal }) => ({ tenantId: principal?.tenantId }),
})
```

#### Variables d'environnement d'auth de référence

- `RASONO_ADMIN_BEARER_TOKEN`
  - Token bearer statique utilisé par le starter pour la route admin d'exemple.
- `RASONO_SERVICE_API_KEY`
  - Clé API statique utilisée par le starter pour la route service d'exemple.
- `RASONO_SESSION_TOKEN`
  - Token de session statique accepté par le starter pour la route session d'exemple.
- `RASONO_SESSION_COOKIE_NAME`
  - Nom du cookie session attendu, `session` par défaut.
- `RASONO_ADMIN_ROLE`, `RASONO_SERVICE_ROLE`, `RASONO_SESSION_ROLE`
  - Noms de rôles utilisés par la policy de référence du starter.
- `RASONO_ADMIN_TENANT_ID`, `RASONO_SERVICE_TENANT_ID`, `RASONO_SESSION_TENANT_ID`
  - Tenant IDs de référence attachés aux principals générés par le starter.

### 6) Overrides de test

```ts
import { createApp } from '@rasono/app'

const app = createApp({
  deps: { db: realDb, mailer: realMailer },
  overrides: {
    mailer: fakeMailer,
  },
})
```

### 3) Erreurs

- Erreur publique standard :
  - `AppError` -> `{ code, message, requestId? }`
  - `HttpError` (style FastAPI) -> `{ code, detail, requestId? }`
- Mapping :
  - validation -> 400
  - auth required -> 401
  - forbidden -> 403
  - not found -> 404
  - conflict -> 409
  - rate limited -> 429
  - unexpected -> 500

### 4) Sécurité par défaut (API)

- CORS : allowlist explicite (pas de `*` si credentials)
- Rate limit : natif par défaut (voir section Rate Limit)
- Limites payload : refuser les grosses requêtes
- Logs : ne jamais logger tokens, mots de passe, cookies, payload complet PII
- SSRF : si fetch d’URL externes, allowlist + blocage ranges internes

## Performance (principes)

- Startup : initialisation O(1) (pas de scan FS, pas de reflection, pas de chargement massif).
- Install : dépendances minimales; éviter les packages lourds.
- Hot path requête : aucun tri, aucune boucle globale; Map/Set + calculs constants.

## Rate Limit (natif)

- Algo : Token Bucket (O(1) par requête, mémoire O(1) par clé) + eviction LRU/TTL.
- Clé par défaut : IP (trustProxy = false par défaut).
- En prod derrière proxy :
  - activer `trustProxy: true` uniquement si le proxy est de confiance.

## Recette “Ajouter un module” (API)

1. Créer `apps/api/src/modules/<module>/`
2. Ajouter :
   - `<module>.module.ts` (frontière de module)
   - `*.schemas.ts` (schemas input/output)
   - `*.service.ts` (use-cases)
   - `api/**.ts` (routes file-based du module)
3. Enregistrer le module dans `apps/api/src/modules/index.ts`

## Injection de dépendances (API)

- Les dépendances “infra” vivent dans `deps` (db, repos, clients externes).
- Dans un handler, utilise `ctx = c.get('rasono')` puis `ctx.deps`.
- Pour garder un style “Depends”, préfère `useDep(ctx, d => d.<dep>)`.

## Background Tasks (API)

- Ajouter une tâche :
  - `const ctx = c.get('rasono')`
  - `ctx.tasks.add(async () => { /* ... */ })`
- Règle : ne jamais bloquer la réponse; les tâches doivent être idempotentes si possible.

## “HTTPException” (style FastAPI)

- Utilise `HttpError` pour des erreurs HTTP volontaires (avec status + detail + headers).
- Exemple :
  - `throw httpError(404, 'User not found', { code: 'USER_NOT_FOUND' })`
- Import recommandé :
  - `import { httpError } from '@rasono/app'`

## createApp (Hono invisible)

- Le serveur ne crée pas `new Hono()`.
- Utilise `createApp()` avec `transport: { adapter, options }`.
- Exemple Hono:

```ts
import { createApp } from '@rasono/app'
import { createHonoAdapter } from '@rasono/hono'

const app = createApp({
  deps: {},
  transport: {
    adapter: createHonoAdapter(),
    options: {
      rateLimit: {
        enabled: true,
      },
    },
  },
})
```

## Routing API automatique (file-based)

- Crée des fichiers dans `apps/api/src/api/**.ts` pour des routes simples, ou dans `apps/api/src/modules/<module>/api/**.ts` pour la structure de référence.
- Lance `rasono gen` ou simplement `npm run dev`.
- Le générateur produit `apps/api/src/.rasono/api.generated.ts` :
  - enregistre les routes `/api/...`
  - expose `/doc` avec une OpenAPI enrichie: réponses d’erreur standardisées (400/401/403/404/409/429/500), codes et exemples JSON par statut, metadata de request body, descriptions de paramètres, `externalDocs` et extension `x-rasono-authz` quand une policy est déclarée

### Watch / Dev

- `rasono dev -- tsx watch src/index.ts`
- Le watcher surveille `src/api`, `src/modules` et `src/actions` uniquement pour rester léger.
- Le hot path dev reste simple :
  - changement fichier API
  - changement fichier action
  - regen manifest
  - `tsx watch` recharge naturellement via le fichier généré

## Server Actions (build-time)

- Crée des fichiers dans `apps/api/src/actions/**.ts`.
- Le générateur produit `apps/api/src/.rasono/actions.generated.ts`.
- Chaque action devient automatiquement un endpoint `POST /actions/...`.
- Utilise `defineServerAction()` depuis `@rasono/actions`.

### Exemple

```ts
import { defineServerAction } from '@rasono/actions'

export default defineServerAction({
  summary: 'Ping action',
  handler: async (input: { name?: string } | undefined) => {
    return { ok: true, message: `pong ${input?.name ?? ''}`.trim() }
  },
})
```

### Appel côté client

```ts
import { createServerActionClient } from '@rasono/actions'

const actions = createServerActionClient({ baseUrl: 'http://localhost:3000' })
await actions.invoke('/actions/ping', { name: 'Ada' })
```

## Routing UI automatique (file-based)

- Crée des pages dans `apps/web/src/app/**.page.tsx`.
- Lance `rasono gen` ou simplement `npm run dev`.
- Le générateur produit `apps/web/src/.rasono/pages.generated.ts`.
- Le fichier `src/app/router.adapter.ts` encapsule Rasengan et `src/app/app.router.ts` consomme seulement l'adapter local + `@rasono/web-core`.

### Conventions

- `apps/web/src/app/index.page.tsx` -> `/`
- `apps/web/src/app/about.page.tsx` -> `/about`
- `apps/web/src/app/blog/index.page.tsx` -> `/blog`
- `apps/web/src/app/blog/[id].page.tsx` -> `/blog/:id`
- `apps/web/src/app/docs/[...slug].page.tsx` -> `/docs/*`

### Générateur de page

- Commande :
  - `rasono generate page about`
  - `rasono generate page blog/[id]`
- Le générateur crée le fichier `.page.tsx` minimal.
- Le path est dérivé du nom de fichier, sauf si la page définit explicitement `Page.path`.

## Générateurs CLI de structure

- `rasono generate module billing`
  - Génère `src/modules/billing/billing.module.ts`
  - Génère `src/modules/billing/billing.service.ts`
  - Génère `src/modules/billing/api/index.ts`
  - Met à jour `src/modules/index.ts`
- `rasono generate policy billing require-admin`
  - Génère `src/modules/billing/require-admin.policy.ts`
- Tous les fichiers générés commencent par un commentaire d'en-tête en anglais expliquant leur rôle.
- La CLI durcit l'analyse des routes via l'AST TypeScript pour éviter les heuristiques fragiles.
- En cas de contrat de route invalide, la CLI remonte un message avec `fichier:ligne:colonne` pour accélérer le debug.
- Ce coût d'analyse reste cantonné au build/codegen et ne touche pas le hot path runtime des requêtes.

## RPC généré (web -> api)

- Le générateur produit `apps/web/src/.rasono/rpc.generated.ts`.
- Il scanne `apps/api/src/api/**` ainsi que `apps/api/src/modules/*/api/**` et crée un client avec autocomplétion structurelle.
- Utilise `createGeneratedRpcClient()` avec `@rasono/web-core`.

### Exemple

```ts
import { createGeneratedRpcClient } from '@/.rasono/rpc.generated'

const rpc = createGeneratedRpcClient({ baseUrl: 'http://localhost:3000' })
await rpc.hello.get()
```

### Conventions

- `apps/api/src/api/users.ts` -> `GET/POST/... /api/users` (selon `method`)
- `apps/api/src/api/users/index.ts` -> `/api/users`
- `apps/api/src/api/users/[id].ts` -> `/api/users/:id`
- `apps/api/src/api/files/[...path].ts` -> `/api/files/*`
- `apps/api/src/modules/users/api/index.ts` -> `/api/users`
- `apps/api/src/modules/users/api/[id].ts` -> `/api/users/:id`

### Erreurs documentées automatiquement

- Chaque route hérite des erreurs standard Rasono :
  - `400 BAD_REQUEST`
  - `401 AUTH_REQUIRED`
  - `403 FORBIDDEN`
  - `404 NOT_FOUND`
  - `409 CONFLICT`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Tu peux ajouter/surcharger les erreurs d’une route :

```ts
import { defineRoute, defineErrors } from '@rasono/app'

export default defineRoute({
  method: 'get',
  errorMode: 'merge', // par defaut
  errors: defineErrors([
    {
      status: 404,
      code: 'USER_NOT_FOUND',
      description: 'User not found',
      detail: 'No user matches this id',
    },
  ]),
  handler: async (c) => { /* ... */ },
})
```

- Si tu veux remplacer complètement les erreurs standard :

```ts
export default defineRoute({
  method: 'post',
  errorMode: 'replace',
  errors: defineErrors([
    { status: 422, code: 'INVALID_PAYLOAD', description: 'Payload invalid' },
  ]),
  handler: async (c) => { /* ... */ },
})
```

## Rasengan (Web) — patterns minimaux

- Router dans `apps/web/src/app/app.router.ts`
- Pages dans `apps/web/src/app/*.page.tsx`
- Entry dans `apps/web/src/index.ts` via `renderApp()`

## Prompts IA utiles

- “Ajoute un module `<x>` (schemas, service, routes) avec validation stricte, erreurs `HttpError`/`AppError`, et logique O(1) sur le hot path.”
- “Sécurise l’endpoint `<y>` : authZ explicite + rate limit + logs safe + requestId.”
- “Refactor : sépare handler HTTP et use-case, injecte le repo via deps, et explique la complexité.”
