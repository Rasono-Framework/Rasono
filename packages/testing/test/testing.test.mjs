/**
 * Purpose: Validate the public runtime contracts that keep Rasono stable across adapters, auth, data providers, and generated manifests.
 * Goal: Catch behavioral regressions in the real integration paths that users depend on, especially around lifecycle and transaction safety.
 * Value: Provides executable proof that framework slices remain compatible, auditable, and production-ready as the monorepo evolves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { buildOpenApiDocument, composePolicies, defineDep, definePolicy, defineRoute, defineSchema, installApiRoute } from '../../app/dist/index.js';
import {
  composePrincipalResolvers,
  createApiKeyPrincipalResolver,
  createBearerPrincipalResolver,
  createSessionPrincipalResolver,
} from '../../auth/dist/index.js';
import { createHonoAdapter } from '../../hono/dist/index.js';
import {
  createDataSessionDep,
  createRepositoryDep,
  defineDataAdapter,
  defineIdempotencyStore,
  defineOutboxStore,
  drainOutboxMessages,
  executeIdempotentOperation,
} from '../../data/dist/index.js';
import { createDrizzleDataAdapter } from '../../data-drizzle/dist/index.js';
import { createKyselyDataAdapter } from '../../data-kysely/dist/index.js';
import {
  createEngineClientFactory,
  createEngineDataAdapter,
  createLibsqlDataAdapter,
  createTursoDataAdapter,
  createTursoLibsqlClientFactory,
} from '../../data-engine/dist/index.js';
import { createTestApp } from '../dist/index.js';
import { createApiClient, createWebRouter } from '../../web-core/dist/index.js';
import { createMemoryRouterAdapter } from '../../web-memory/dist/index.js';

const execFile = promisify(execFileCallback);
const cliEntry = new URL('../../cli/dist/index.js', import.meta.url);
const createRasonoEntry = new URL('../../create-rasono/dist/index.js', import.meta.url);

test('createTestApp applique les overrides et nettoie les deps request-scoped', async () => {
  let disposed = 0;

  const testApp = await createTestApp({
    transport: {
      adapter: createHonoAdapter(),
    },
    deps: {
      greeter: {
        greet: () => 'real',
      },
    },
    overrides: {
      greeter: {
        greet: () => 'fake',
      },
    },
    dependencies: {
      requestMarker: defineDep({
        scope: 'request',
        create: () => ({ id: crypto.randomUUID() }),
        dispose: async () => {
          disposed += 1;
        },
      }),
    },
    setup: (app) => {
      installApiRoute(
        app,
        '/hello',
        defineRoute({
          method: 'get',
          handler: (_c, { deps }) => ({
            message: deps.greeter.greet(),
            marker: deps.requestMarker.id,
          }),
        }),
      );
    },
  });

  try {
    const first = await testApp.client.get('/hello');
    const second = await testApp.client.get('/hello');

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const firstJson = await first.json();
    const secondJson = await second.json();

    assert.equal(firstJson.message, 'fake');
    assert.equal(secondJson.message, 'fake');
    assert.notEqual(firstJson.marker, secondJson.marker);
    assert.equal(disposed, 2);
  } finally {
    await testApp.close();
  }
});

test('resolvePrincipal alimente auth.required et auth.roles', async () => {
  const testApp = await createTestApp({
    transport: {
      adapter: createHonoAdapter(),
    },
    deps: {
      authService: {
        verifyBearerToken: async (raw) => {
          if (raw === 'Bearer admin-token') {
            return { sub: 'admin-user', roles: ['admin'] };
          }
          return undefined;
        },
      },
    },
    resolvePrincipal: async ({ request, deps }) => {
      const authorization = request.headers.get('authorization');
      if (!authorization) return undefined;
      return deps.authService.verifyBearerToken(authorization);
    },
    setup: (app) => {
      installApiRoute(
        app,
        '/admin',
        defineRoute({
          method: 'get',
          auth: {
            required: true,
            roles: ['admin'],
            scheme: 'bearer',
          },
          handler: (_c, { principal }) => ({
            ok: true,
            sub: principal?.sub,
          }),
        }),
      );
    },
  });

  try {
    const unauthorized = await testApp.client.get('/admin');
    assert.equal(unauthorized.status, 401);
    const unauthorizedJson = await unauthorized.json();
    assert.equal(unauthorizedJson.code, 'AUTH_REQUIRED');
    assert.equal(unauthorizedJson.message, 'Authentication required');
    assert.equal(typeof unauthorizedJson.requestId, 'string');

    const authorized = await testApp.client.get('/admin', {
      headers: {
        authorization: 'Bearer admin-token',
      },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), {
      ok: true,
      sub: 'admin-user',
    });
  } finally {
    await testApp.close();
  }
});

test('le client de test envoie query string et body JSON', async () => {
  const testApp = await createTestApp({
    transport: {
      adapter: createHonoAdapter(),
    },
    deps: {},
    setup: (app) => {
      installApiRoute(
        app,
        '/echo',
        defineRoute({
          method: 'post',
          handler: async (c) => {
            const body = await c.req.json();
            return {
              query: c.req.query('name'),
              body,
            };
          },
        }),
      );
    },
  });

  try {
    const response = await testApp.client.post('/echo', {
      query: { name: 'rasono' },
      json: { ok: true },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      query: 'rasono',
      body: { ok: true },
    });
  } finally {
    await testApp.close();
  }
});

test('defineRoute supporte les cookies et les metadonnees de reponse HTTP', async () => {
  const sessionCookie = defineSchema(
    (input) => {
      if (!input || typeof input !== 'object') throw new Error('Expected cookies object');
      const value = input;
      if (typeof value.session !== 'string') throw new Error('Expected session cookie');
      return { session: value.session };
    },
    {
      type: 'object',
      properties: {
        session: { type: 'string' },
      },
      required: ['session'],
      additionalProperties: false,
    },
  );

  const testApp = await createTestApp({
    transport: {
      adapter: createHonoAdapter(),
    },
    deps: {},
    setup: (app) => {
      installApiRoute(
        app,
        '/session',
        defineRoute({
          method: 'get',
          input: {
            cookies: sessionCookie,
          },
          response: {
            status: 202,
            contentType: 'text/plain',
            description: 'Accepted plain text response',
          },
          handler: (_c, { input }) => `accepted:${input.cookies.session}`,
        }),
      );
    },
  });

  try {
    const response = await testApp.client.get('/session', {
      headers: {
        cookie: 'session=abc123',
      },
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('content-type'), 'text/plain');
    assert.equal(await response.text(), 'accepted:abc123');
  } finally {
    await testApp.close();
  }
});

test('defineRoute supporte des policies d autorisation fines apres auth.required', async () => {
  const ownerQuery = defineSchema(
    (input) => {
      if (!input || typeof input !== 'object') throw new Error('Expected query object');
      const value = input;
      if (typeof value.ownerId !== 'string') throw new Error('Expected ownerId query');
      return { ownerId: value.ownerId };
    },
    {
      type: 'object',
      properties: {
        ownerId: { type: 'string' },
      },
      required: ['ownerId'],
      additionalProperties: false,
    },
  );

  const sameOwner = definePolicy(({ principal, input }) => {
    return principal?.sub === input.query.ownerId;
  });

  const hasUserRole = definePolicy(({ principal }) => {
    return (principal?.roles ?? []).includes('user');
  });

  const testApp = await createTestApp({
    transport: {
      adapter: createHonoAdapter(),
    },
    deps: {},
    resolvePrincipal: async ({ request }) => {
      const authorization = request.headers.get('authorization');
      if (authorization === 'Bearer owner-token') {
        return { sub: 'user-1', roles: ['user'] };
      }
      return undefined;
    },
    setup: (app) => {
      installApiRoute(
        app,
        '/owners',
        defineRoute({
          method: 'get',
          input: {
            query: ownerQuery,
          },
          auth: {
            required: true,
          },
          policy: composePolicies([hasUserRole, sameOwner]),
          handler: () => ({
            ok: true,
          }),
        }),
      );
    },
  });

  try {
    const unauthorized = await testApp.client.get('/owners', {
      query: { ownerId: 'user-1' },
    });
    assert.equal(unauthorized.status, 401);

    const forbidden = await testApp.client.get('/owners', {
      query: { ownerId: 'user-2' },
      headers: {
        authorization: 'Bearer owner-token',
      },
    });
    assert.equal(forbidden.status, 403);

    const allowed = await testApp.client.get('/owners', {
      query: { ownerId: 'user-1' },
      headers: {
        authorization: 'Bearer owner-token',
      },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true });
  } finally {
    await testApp.close();
  }
});

test('defineRoute supporte une isolation tenant simple via principal.tenantId', async () => {
  const tenantQuery = defineSchema(
    (input) => {
      if (!input || typeof input !== 'object') throw new Error('Expected tenant query');
      const value = input;
      if (typeof value.tenantId !== 'string') throw new Error('Expected tenantId query');
      return { tenantId: value.tenantId };
    },
    {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
      },
      required: ['tenantId'],
      additionalProperties: false,
    },
  );

  const sameTenant = definePolicy(({ principal, input }) => principal?.tenantId === input.query.tenantId);

  const testApp = await createTestApp({
    transport: {
      adapter: createHonoAdapter(),
    },
    deps: {},
    resolvePrincipal: async ({ request }) => {
      const authorization = request.headers.get('authorization');
      if (authorization === 'Bearer tenant-token') {
        return { sub: 'tenant-user', roles: ['user'], tenantId: 'tenant-a' };
      }
      return undefined;
    },
    setup: (app) => {
      installApiRoute(
        app,
        '/tenant',
        defineRoute({
          method: 'get',
          input: {
            query: tenantQuery,
          },
          auth: {
            required: true,
          },
          policy: sameTenant,
          handler: (_c, { principal, input }) => ({
            ok: true,
            subject: principal?.sub,
            tenantId: input.query.tenantId,
          }),
        }),
      );
    },
  });

  try {
    const forbidden = await testApp.client.get('/tenant', {
      query: { tenantId: 'tenant-b' },
      headers: {
        authorization: 'Bearer tenant-token',
      },
    });
    assert.equal(forbidden.status, 403);

    const allowed = await testApp.client.get('/tenant', {
      query: { tenantId: 'tenant-a' },
      headers: {
        authorization: 'Bearer tenant-token',
      },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), {
      ok: true,
      subject: 'tenant-user',
      tenantId: 'tenant-a',
    });
  } finally {
    await testApp.close();
  }
});

test('buildOpenApiDocument produit une spec plus riche avec metadata, exemples et authz', () => {
  const payloadSchema = defineSchema(
    (input) => input,
    {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  );

  const responseSchema = defineSchema(
    (input) => input,
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  );

  const document = buildOpenApiDocument(
    [
      {
        file: '../modules/widgets/api/create.js',
        path: '/api/widgets/:widgetId',
        route: defineRoute({
          method: 'post',
          operationId: 'widgetsCreate',
          summary: 'Create widget',
          description: 'Creates a widget with strict OpenAPI metadata.',
          tags: ['widgets'],
          input: {
            body: payloadSchema,
            params: defineSchema(
              (input) => input,
              {
                type: 'object',
                properties: {
                  widgetId: { type: 'string' },
                },
                required: ['widgetId'],
                additionalProperties: false,
              },
            ),
            query: defineSchema(
              (input) => input,
              {
                type: 'object',
                properties: {
                  expand: { type: 'string' },
                },
                additionalProperties: false,
              },
            ),
          },
          auth: {
            required: true,
            roles: ['admin'],
            scheme: 'bearer',
          },
          policy: definePolicy(() => true),
          openapi: {
            params: {
              widgetId: {
                description: 'Widget identifier',
                example: 'wid_123',
              },
            },
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
            schema: responseSchema,
            headers: {
              location: { type: 'string' },
            },
            examples: {
              created: {
                summary: 'Created widget',
                value: { id: 'wid_123' },
              },
            },
          },
          errors: [
            {
              status: 422,
              code: 'INVALID_WIDGET',
              description: 'Widget payload invalid',
              example: { code: 'INVALID_WIDGET', detail: 'name is invalid' },
            },
          ],
          handler: () => ({ id: 'wid_123' }),
        }),
      },
    ],
    { title: 'Spec', version: '1.0.0' },
  );

  const operation = document.paths['/api/widgets/:widgetId'].post;
  assert.equal(operation.operationId, 'widgetsCreate');
  assert.equal(operation.requestBody.description, 'Widget creation payload');
  assert.deepEqual(operation.requestBody.content['application/json'].examples.default.value, { name: 'Demo widget' });
  assert.equal(operation.parameters[0].description, 'Widget identifier');
  assert.equal(operation.parameters[1].description, 'Optional relation expansion');
  assert.equal(operation.responses['201'].headers.location.schema.type, 'string');
  assert.deepEqual(operation.responses['201'].content['application/json'].examples.created.value, { id: 'wid_123' });
  assert.deepEqual(operation.responses['422'].content['application/json'].examples.INVALID_WIDGET.value, {
    code: 'INVALID_WIDGET',
    detail: 'name is invalid',
  });
  assert.equal(operation.externalDocs.url, 'https://example.test/docs/widgets');
  assert.equal(operation['x-rasono-authz'].hasPolicy, true);
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
});

test('@rasono/data fournit une session request-scoped, des transactions et des repositories officiels', async () => {
  let opened = 0;
  let closed = 0;
  let committed = 0;
  let rolledBack = 0;

  const adapter = defineDataAdapter({
    name: 'memory-db',
    openSession: async () => {
      opened += 1;
      return { log: [] };
    },
    closeSession: async () => {
      closed += 1;
    },
    beginTransaction: async (session) => ({ session }),
    commitTransaction: async () => {
      committed += 1;
    },
    rollbackTransaction: async () => {
      rolledBack += 1;
    },
  });

  const testApp = await createTestApp({
    transport: {
      adapter: createHonoAdapter(),
    },
    deps: {},
    dependencies: {
      db: createDataSessionDep(adapter),
      widgetRepository: createRepositoryDep({
        sessionKey: 'db',
        create: ({ session }) => ({
          async create(name) {
            return session.withTransaction(async ({ session: rawSession, transaction }) => {
              rawSession.log.push(`insert:${name}`);
              transaction.session.log.push(`tx:${name}`);
              return { name, adapter: session.adapterName };
            });
          },
          async fail() {
            return session.withTransaction(async ({ session: rawSession }) => {
              rawSession.log.push('will-fail');
              throw new Error('boom');
            });
          },
        }),
      }),
    },
    setup: (app) => {
      installApiRoute(
        app,
        '/widgets',
        defineRoute({
          method: 'post',
          handler: async (_c, { deps }) => deps.widgetRepository.create('widget-a'),
        }),
      );
      installApiRoute(
        app,
        '/widgets/fail',
        defineRoute({
          method: 'post',
          handler: async (_c, { deps }) => deps.widgetRepository.fail(),
        }),
      );
    },
  });

  try {
    const created = await testApp.client.post('/widgets');
    assert.equal(created.status, 200);
    assert.deepEqual(await created.json(), { name: 'widget-a', adapter: 'memory-db' });

    const failed = await testApp.client.post('/widgets/fail');
    assert.equal(failed.status, 500);

    assert.equal(opened, 2);
    assert.equal(closed, 2);
    assert.equal(committed, 1);
    assert.equal(rolledBack, 1);
  } finally {
    await testApp.close();
  }
});

test('@rasono/data fournit une primitive d idempotence explicite pour les commandes critiques', async () => {
  const records = new Map();
  let executed = 0;

  const store = defineIdempotencyStore({
    async begin({ key, fingerprint }) {
      const existing = records.get(key);
      if (!existing) {
        const created = { key, fingerprint, state: 'in_progress' };
        records.set(key, created);
        return { kind: 'started', record: created };
      }
      if (existing.fingerprint !== fingerprint) {
        return { kind: 'conflict', record: existing };
      }
      if (existing.state === 'completed') {
        return { kind: 'replayed', record: existing };
      }
      return { kind: 'in_progress', record: existing };
    },
    async complete({ key, response }) {
      const next = {
        ...records.get(key),
        state: 'completed',
        response,
      };
      records.set(key, next);
      return next;
    },
    async fail({ key, error }) {
      const next = {
        ...records.get(key),
        state: 'failed',
        error,
      };
      records.set(key, next);
      return next;
    },
  });

  const first = await executeIdempotentOperation({
    store,
    key: 'payment:create:1',
    fingerprint: 'sha256:payload-a',
    execute: async () => {
      executed += 1;
      return { paymentId: 'pay_1', status: 'authorized' };
    },
  });

  const replay = await executeIdempotentOperation({
    store,
    key: 'payment:create:1',
    fingerprint: 'sha256:payload-a',
    execute: async () => {
      executed += 1;
      return { paymentId: 'pay_2', status: 'authorized' };
    },
  });

  const conflict = await executeIdempotentOperation({
    store,
    key: 'payment:create:1',
    fingerprint: 'sha256:payload-b',
    execute: async () => {
      executed += 1;
      return { paymentId: 'pay_3', status: 'authorized' };
    },
  });

  assert.equal(first.kind, 'executed');
  assert.deepEqual(first.result, { paymentId: 'pay_1', status: 'authorized' });
  assert.equal(replay.kind, 'replayed');
  assert.deepEqual(replay.result, { paymentId: 'pay_1', status: 'authorized' });
  assert.equal(conflict.kind, 'conflict');
  assert.equal(executed, 1);
});

test('@rasono/data persiste un echec idempotent avec une erreur serialisee sans details sensibles', async () => {
  const records = new Map();

  const store = defineIdempotencyStore({
    async begin({ key, fingerprint }) {
      const created = { key, fingerprint, state: 'in_progress' };
      records.set(key, created);
      return { kind: 'started', record: created };
    },
    async complete({ key, response }) {
      const next = {
        ...records.get(key),
        state: 'completed',
        response,
      };
      records.set(key, next);
      return next;
    },
    async fail({ key, error }) {
      const next = {
        ...records.get(key),
        state: 'failed',
        error,
      };
      records.set(key, next);
      return next;
    },
  });

  await assert.rejects(
    async () => {
      await executeIdempotentOperation({
        store,
        key: 'payment:capture:1',
        fingerprint: 'sha256:capture-a',
        execute: async () => {
          const error = new Error('card declined');
          error.code = 'CARD_DECLINED';
          throw error;
        },
      });
    },
    /card declined/,
  );

  assert.deepEqual(records.get('payment:capture:1'), {
    key: 'payment:capture:1',
    fingerprint: 'sha256:capture-a',
    state: 'failed',
    error: {
      name: 'Error',
      message: 'card declined',
      code: 'CARD_DECLINED',
    },
  });
});

test('@rasono/data fournit un drain d outbox explicite pour eviter les dual writes fragiles', async () => {
  const acknowledged = [];
  const released = [];

  const store = defineOutboxStore({
    async enqueue() {},
    async lease() {
      return [
        { id: 'evt_1', topic: 'payments.authorized', payload: { paymentId: 'pay_1' } },
        { id: 'evt_2', topic: 'payments.captured', payload: { paymentId: 'pay_2' } },
      ];
    },
    async acknowledge({ message }) {
      acknowledged.push(message.id);
    },
    async release({ message, error, retryAt }) {
      released.push({ id: message.id, error, retryAt });
    },
  });

  const result = await drainOutboxMessages({
    store,
    consumer: 'billing-worker',
    limit: 10,
    retryAt: (error, message) => (message.id === 'evt_2' && error.code ? '2026-07-10T14:30:00.000Z' : undefined),
    handle: async (message) => {
      if (message.id === 'evt_2') {
        const error = new Error('downstream unavailable');
        error.code = 'DOWNSTREAM_UNAVAILABLE';
        throw error;
      }
    },
  });

  assert.deepEqual(result, {
    leased: 2,
    processed: 1,
    failed: 1,
    failures: [
      {
        message: { id: 'evt_2', topic: 'payments.captured', payload: { paymentId: 'pay_2' } },
        error: {
          name: 'Error',
          message: 'downstream unavailable',
          code: 'DOWNSTREAM_UNAVAILABLE',
        },
      },
    ],
  });
  assert.deepEqual(acknowledged, ['evt_1']);
  assert.deepEqual(released, [
    {
      id: 'evt_2',
      error: {
        name: 'Error',
        message: 'downstream unavailable',
        code: 'DOWNSTREAM_UNAVAILABLE',
      },
      retryAt: '2026-07-10T14:30:00.000Z',
    },
  ]);
});

test('@rasono/data preserve l erreur primaire si la release outbox echoue aussi', async () => {
  const store = defineOutboxStore({
    async enqueue() {},
    async lease() {
      return [{ id: 'evt_3', topic: 'payments.failed', payload: { paymentId: 'pay_3' } }];
    },
    async acknowledge() {
      throw new Error('ack should not be called');
    },
    async release() {
      throw new Error('release-failed');
    },
  });

  await assert.rejects(
    async () => {
      await drainOutboxMessages({
        store,
        consumer: 'billing-worker',
        limit: 10,
        handle: async () => {
          throw new Error('publish-failed');
        },
      });
    },
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /outbox release cleanup also failed/);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[0].message, /publish-failed/);
      assert.match(error.errors[1].message, /release-failed/);
      return true;
    },
  );
});

test('@rasono/data-drizzle fournit un provider fin qui preserve la transaction native Drizzle', async () => {
  let opened = 0;
  let closed = 0;

  const drizzleClient = {
    async transaction(work, config) {
      assert.deepEqual(config, { isolationLevel: 'serializable' });
      return work({ kind: 'drizzle-tx' });
    },
  };

  const adapter = createDrizzleDataAdapter({
    name: 'drizzle-libsql',
    client: async () => {
      opened += 1;
      return drizzleClient;
    },
    transactionOptions: {
      isolationLevel: 'serializable',
    },
    closeSession: async () => {
      closed += 1;
    },
  });

  const session = await adapter.openSession();
  const result = await adapter.runInTransaction?.(session, async (transaction) => ({
    adapterName: adapter.name,
    transactionKind: transaction.kind,
  }));
  await adapter.closeSession?.(session);

  assert.deepEqual(result, {
    adapterName: 'drizzle-libsql',
    transactionKind: 'drizzle-tx',
  });
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

test('@rasono/data-kysely fournit un provider fin multi-base avec isolation explicite', async () => {
  let opened = 0;
  let closed = 0;
  const events = [];

  const kyselyClient = {
    transaction() {
      events.push('transaction');
      return {
        setIsolationLevel(level) {
          events.push(`isolation:${level}`);
          return {
            execute: async (work) => work({ kind: 'kysely-tx' }),
          };
        },
      };
    },
  };

  const adapter = createKyselyDataAdapter({
    name: 'kysely-postgres',
    client: async () => {
      opened += 1;
      return kyselyClient;
    },
    isolationLevel: 'serializable',
    closeSession: async () => {
      closed += 1;
    },
  });

  const session = await adapter.openSession();
  const result = await adapter.runInTransaction?.(session, async (transaction) => ({
    adapterName: adapter.name,
    transactionKind: transaction.kind,
  }));
  await adapter.closeSession?.(session);

  assert.deepEqual(result, {
    adapterName: 'kysely-postgres',
    transactionKind: 'kysely-tx',
  });
  assert.deepEqual(events, ['transaction', 'isolation:serializable']);
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

test('@rasono/data-kysely permet une configuration transactionnelle avancee sans cacher Kysely', async () => {
  const events = [];

  const adapter = createKyselyDataAdapter({
    client: {
      transaction() {
        events.push('transaction');
        return {
          setIsolationLevel(level) {
            events.push(`isolation:${level}`);
            return {
              execute: async (work) => {
                events.push('execute');
                return work({ kind: 'kysely-controlled' });
              },
            };
          },
          execute: async (work) => {
            events.push('execute');
            return work({ kind: 'kysely-controlled' });
          },
        };
      },
    },
    isolationLevel: 'read committed',
    configureTransaction: (builder) => {
      events.push('configure');
      return builder;
    },
  });

  const session = await adapter.openSession();
  const result = await adapter.runInTransaction?.(session, async (transaction) => transaction.kind);

  assert.equal(result, 'kysely-controlled');
  assert.deepEqual(events, ['transaction', 'isolation:read committed', 'configure', 'execute']);
});

test('@rasono/data-kysely echoue proprement si l isolation explicite n est pas supportee', async () => {
  const adapter = createKyselyDataAdapter({
    client: {
      transaction() {
        return {
          execute: async (work) => work({ kind: 'tx' }),
        };
      },
    },
    isolationLevel: 'serializable',
  });

  const session = await adapter.openSession();

  await assert.rejects(
    async () => {
      await adapter.runInTransaction?.(session, async () => 'ok');
    },
    /does not support setIsolationLevel/,
  );
});

test('@rasono/data-kysely ferme la session via destroy par defaut', async () => {
  const events = [];

  const adapter = createKyselyDataAdapter({
    client: {
      transaction() {
        return {
          execute: async (work) => work({ kind: 'tx' }),
        };
      },
      async destroy() {
        events.push('destroy');
      },
    },
  });

  const session = await adapter.openSession();
  await adapter.closeSession?.(session);

  assert.deepEqual(events, ['destroy']);
});

test('@rasono/data-engine orchestre les transactions et la sync Turso sans masquer le client natif', async () => {
  const events = [];

  const transaction = {
    async commit() {
      events.push('commit');
    },
    async rollback() {
      events.push('rollback');
    },
    async close() {
      events.push('close');
    },
    async execute(statement) {
      events.push(`execute:${statement.sql}`);
      return { rows: [] };
    },
  };

  const adapter = createEngineDataAdapter({
    name: 'engine',
    transactionMode: 'read',
    syncOnOpen: true,
    syncOnClose: true,
    client: async () => ({
      async sync() {
        events.push('sync');
      },
      async close() {
        events.push('client-close');
      },
      async transaction(mode) {
        events.push(`transaction:${mode}`);
        return transaction;
      },
    }),
  });

  const client = await adapter.openSession();
  const result = await adapter.runInTransaction?.(client, async (tx) => {
    await tx.execute({ sql: 'select 1' });
    return 'ok';
  });
  await adapter.closeSession?.(client);

  assert.equal(result, 'ok');
  assert.deepEqual(events, [
    'sync',
    'transaction:read',
    'execute:select 1',
    'commit',
    'close',
    'sync',
    'client-close',
  ]);
});

test('@rasono/data-engine rollback puis close la transaction sur erreur', async () => {
  const events = [];

  const adapter = createEngineDataAdapter({
    client: {
      transaction: async () => ({
        async commit() {
          events.push('commit');
        },
        async rollback() {
          events.push('rollback');
        },
        async close() {
          events.push('close');
        },
      }),
    },
  });

  await assert.rejects(
    async () => {
      const client = await adapter.openSession();
      await adapter.runInTransaction?.(client, async () => {
        throw new Error('boom');
      });
    },
    /boom/,
  );

  assert.deepEqual(events, ['rollback', 'close']);
});

test('@rasono/data-engine preserve la compatibilite des anciens alias techniques', async () => {
  assert.equal(createTursoDataAdapter, createEngineDataAdapter);
  assert.equal(createLibsqlDataAdapter, createTursoDataAdapter);
  assert.equal(createTursoLibsqlClientFactory, createEngineClientFactory);
});

test('@rasono/data-engine preserve l erreur primaire si rollback et close echouent aussi', async () => {
  const events = [];

  const adapter = createEngineDataAdapter({
    client: {
      transaction: async () => ({
        closed: false,
        async commit() {
          events.push('commit');
        },
        async rollback() {
          events.push('rollback');
          throw new Error('rollback-failed');
        },
        async close() {
          events.push('close');
          throw new Error('close-failed');
        },
      }),
    },
  });

  await assert.rejects(
    async () => {
      const client = await adapter.openSession();
      await adapter.runInTransaction?.(client, async () => {
        throw new Error('work-failed');
      });
    },
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /close cleanup also failed/);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[0].message, /work-failed|rollback cleanup also failed/);
      assert.match(error.errors[1].message, /close-failed/);
      return true;
    },
  );

  assert.deepEqual(events, ['rollback', 'close']);
});

test('@rasono/data-engine construit un client Engine depuis une factory createClient compatible', async () => {
  const factory = createEngineClientFactory(
    (options) => options,
    {
      url: 'libsql://primary.turso.io',
      authToken: 'secret',
      syncUrl: 'libsql://replica.turso.io',
      syncInterval: 60,
      offline: true,
      concurrency: 8,
    },
  );

  assert.deepEqual(await factory(), {
    url: 'libsql://primary.turso.io',
    authToken: 'secret',
    syncUrl: 'libsql://replica.turso.io',
    syncInterval: 60,
    offline: true,
    concurrency: 8,
  });
});

test('web-core fournit un client API et un helper d adapter web decouples de Rasengan', async () => {
  const api = createApiClient({
    baseUrl: 'https://example.test',
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      assert.equal(url, 'https://example.test/ping?name=rasono');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.headers['x-test'], 'yes');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const response = await api.request({
    method: 'POST',
    path: '/ping',
    query: { name: 'rasono' },
    headers: { 'x-test': 'yes' },
  });
  assert.deepEqual(response, { ok: true });

  const router = createWebRouter(
    {
      name: 'fake-ui',
      createRouter: ({ pages }) => ({ pages, adapter: 'fake-ui' }),
    },
    { pages: ['/', '/docs'] },
  );

  assert.deepEqual(router, {
    pages: ['/', '/docs'],
    adapter: 'fake-ui',
  });
});

test('la CLI genere les manifests API depuis src/modules/*/api', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'rasono-cli-'));
  try {
    await mkdir(join(rootDir, 'src/modules/system/api'), { recursive: true });
    await writeFile(
      join(rootDir, 'src/modules/system/api/hello.ts'),
      `import { defineRoute } from '@rasono/app';

export default defineRoute({
  method: 'get',
  summary: 'Hello from module route',
});
`,
      'utf8',
    );

    await execFile('node', [cliEntry.pathname, 'gen', `--root=${rootDir}`], {
      cwd: new URL('../', import.meta.url),
    });

    const generatedApi = await readFile(join(rootDir, 'src/.rasono/api.generated.ts'), 'utf8');
    assert.match(generatedApi, /import route_0 from '\.\.\/modules\/system\/api\/hello\.js';/);
    assert.match(generatedApi, /path: '\/api\/system\/hello'/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('la CLI genere un module et une policy selon la convention Rasono', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'rasono-cli-scaffold-'));
  try {
    await mkdir(join(rootDir, 'src/modules'), { recursive: true });
    await writeFile(
      join(rootDir, 'src/modules/index.ts'),
      `/**
 * This file centralizes the app module registry used by createApp().
 */
export const appModules = [];
`,
      'utf8',
    );

    await execFile('node', [cliEntry.pathname, 'generate', 'module', 'billing', `--root=${rootDir}`], {
      cwd: new URL('../', import.meta.url),
    });
    await execFile('node', [cliEntry.pathname, 'generate', 'policy', 'billing', 'require-admin', `--root=${rootDir}`], {
      cwd: new URL('../', import.meta.url),
    });

    const moduleFile = await readFile(join(rootDir, 'src/modules/billing/billing.module.ts'), 'utf8');
    assert.match(moduleFile, /This file declares a domain module following the official Rasono module boundary/);
    assert.match(moduleFile, /export const billingModule/);

    const routeFile = await readFile(join(rootDir, 'src/modules/billing/api/index.ts'), 'utf8');
    assert.match(routeFile, /This file exposes the generated module route entrypoint/);
    assert.match(routeFile, /operationId: 'billingList'/);

    const policyFile = await readFile(join(rootDir, 'src/modules/billing/require-admin.policy.ts'), 'utf8');
    assert.match(policyFile, /This file defines a reusable authorization policy for a Rasono module/);
    assert.match(policyFile, /requireAdminPolicy/);

    const modulesIndex = await readFile(join(rootDir, 'src/modules/index.ts'), 'utf8');
    assert.match(modulesIndex, /import \{ billingModule \} from '\.\/billing\/billing\.module\.js';/);
    assert.match(modulesIndex, /billingModule/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('la CLI remonte une erreur AST avec fichier, ligne et colonne exacts sur une route invalide', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'rasono-cli-ast-'));
  const rootDir = join(tempDir, 'web');
  const apiDir = join(tempDir, 'api');
  try {
    await mkdir(rootDir, { recursive: true });
    await mkdir(join(apiDir, 'src/api'), { recursive: true });
    await writeFile(
      join(apiDir, 'src/api/broken.ts'),
      `import { defineRoute } from '@rasono/app';

export default defineRoute({
  method: dynamicMethod,
  handler: () => ({ ok: true }),
});
`,
      'utf8',
    );

    await assert.rejects(
      execFile('node', [cliEntry.pathname, 'gen', `--root=${rootDir}`], {
        cwd: new URL('../', import.meta.url),
      }),
      (error) => {
        const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}\n${error?.message ?? ''}`;
        assert.match(output, /broken\.ts:4:11/);
        assert.match(output, /expected `method` to be a static string literal/);
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('@rasono/auth compose des resolvers bearer et api key sans couplage transport', async () => {
  const resolver = composePrincipalResolvers([
    createBearerPrincipalResolver({
      verifyToken: async (token) => {
        if (token === 'admin-token') return { sub: 'admin', roles: ['admin'] };
        return undefined;
      },
    }),
    createApiKeyPrincipalResolver({
      verifyKey: async (apiKey) => {
        if (apiKey === 'key-123') return { sub: 'service', roles: ['service'] };
        return undefined;
      },
    }),
  ]);

  const fromBearer = await resolver({
    request: new Request('https://example.test', {
      headers: { authorization: 'Bearer admin-token' },
    }),
  });
  assert.deepEqual(fromBearer, { sub: 'admin', roles: ['admin'] });

  const fromApiKey = await resolver({
    request: new Request('https://example.test', {
      headers: { 'x-api-key': 'key-123' },
    }),
  });
  assert.deepEqual(fromApiKey, { sub: 'service', roles: ['service'] });

  const malformed = await resolver({
    request: new Request('https://example.test', {
      headers: { authorization: 'Bearer too many parts here' },
    }),
  });
  assert.equal(malformed, undefined);
});

test('@rasono/auth resolve aussi des sessions via cookie sans couplage transport', async () => {
  const resolver = createSessionPrincipalResolver({
    cookieName: 'session_id',
    verifySession: async (sessionToken) => {
      if (sessionToken === 'sess-123') return { sub: 'session-user', roles: ['user'], tenantId: 'tenant-a' };
      return undefined;
    },
  });

  const resolved = await resolver({
    request: new Request('https://example.test', {
      headers: { cookie: 'theme=dark; session_id=sess-123' },
    }),
  });
  assert.deepEqual(resolved, { sub: 'session-user', roles: ['user'], tenantId: 'tenant-a' });

  const missing = await resolver({
    request: new Request('https://example.test', {
      headers: { cookie: 'theme=dark' },
    }),
  });
  assert.equal(missing, undefined);
});

test('create-rasono genere un starter API avec auth de reference et commentaires d en-tete', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'rasono-create-'));
  try {
    const { stdout } = await execFile('node', [createRasonoEntry.pathname, 'app', '--preset=api-only', '--yes', '--no-install'], {
      cwd: rootDir,
    });
    assert.match(stdout, /Rasono starter ready/);
    assert.match(stdout, /Equivalent non-interactive command/);
    assert.match(stdout, /Data provider: none/);
    assert.match(stdout, /Database: none/);

    const apiPackage = await readFile(join(rootDir, 'app/apps/api/package.json'), 'utf8');
    assert.match(apiPackage, /"@rasono\/auth":/);

    const apiIndex = await readFile(join(rootDir, 'app/apps/api/src/index.ts'), 'utf8');
    assert.match(apiIndex, /createSessionPrincipalResolver/);
    assert.match(apiIndex, /This file boots the API runtime/);

    const authService = await readFile(join(rootDir, 'app/apps/api/src/modules/auth/auth.service.ts'), 'utf8');
    assert.match(authService, /This file implements the starter reference auth service/);
    assert.match(authService, /verifySessionToken/);

    const authPolicies = await readFile(join(rootDir, 'app/apps/api/src/modules/auth/auth.policies.ts'), 'utf8');
    assert.match(authPolicies, /This file defines reusable authorization policies/);
    assert.match(authPolicies, /requireReferenceAccess/);
    assert.match(authPolicies, /requireTenantAccess/);

    const sessionRoute = await readFile(join(rootDir, 'app/apps/api/src/modules/auth/api/session.ts'), 'utf8');
    assert.match(sessionRoute, /scheme: 'session'/);
    assert.match(sessionRoute, /input:\s*\{\s*cookies:/);
    assert.match(sessionRoute, /policy: requireReferenceAccess/);

    const tenantRoute = await readFile(join(rootDir, 'app/apps/api/src/modules/auth/api/tenant.ts'), 'utf8');
    assert.match(tenantRoute, /Tenant scoped endpoint/);
    assert.match(tenantRoute, /principal\?\.tenantId === input\.query\.tenantId/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('create-rasono genere un starter API avec provider data et base choisis via flags', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'rasono-create-data-'));
  try {
    const { stdout } = await execFile(
      'node',
      [createRasonoEntry.pathname, 'app', '--preset=api-only', '--yes', '--no-install', '--data=kysely', '--database=postgres'],
      {
        cwd: rootDir,
      },
    );

    assert.match(stdout, /Data provider: kysely/);
    assert.match(stdout, /Database: postgres/);
    assert.match(stdout, /--data=kysely --database=postgres/);

    const apiPackage = await readFile(join(rootDir, 'app/apps/api/package.json'), 'utf8');
    assert.match(apiPackage, /"@rasono\/data":/);
    assert.match(apiPackage, /"@rasono\/data-kysely":/);
    assert.match(apiPackage, /"kysely":/);
    assert.match(apiPackage, /"pg":/);
    assert.match(apiPackage, /"@types\/pg":/);

    const dataIndex = await readFile(join(rootDir, 'app/apps/api/src/data/index.ts'), 'utf8');
    assert.match(dataIndex, /createKyselyDataAdapter/);
    assert.match(dataIndex, /PostgresDialect/);
    assert.match(dataIndex, /DATABASE_URL/);

    const envExample = await readFile(join(rootDir, 'app/apps/api/.env.example'), 'utf8');
    assert.match(envExample, /RASONO_DATA_PROVIDER=kysely/);
    assert.match(envExample, /RASONO_DATABASE_KIND=postgres/);
    assert.match(envExample, /DATABASE_URL=postgresql:/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('create-rasono rejette une combinaison provider base invalide', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'rasono-create-invalid-data-'));
  try {
    await assert.rejects(
      () =>
        execFile(
          'node',
          [createRasonoEntry.pathname, 'app', '--preset=api-only', '--yes', '--no-install', '--data=engine', '--database=postgres'],
          {
            cwd: rootDir,
          },
        ),
      /Unsupported database for engine: postgres/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('create-rasono fails fast without a TTY when interactive answers would be required', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'rasono-create-guided-'));
  try {
    await assert.rejects(
      () =>
        execFile('node', [createRasonoEntry.pathname], {
          cwd: rootDir,
        }),
      /Interactive mode requires a TTY/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('create-rasono prints English help with flags for guided or non-interactive usage', async () => {
  const { stdout } = await execFile('node', [createRasonoEntry.pathname, '--help'], {
    cwd: new URL('../', import.meta.url),
  });

  assert.match(stdout, /Usage:\s+create-rasono \[target\] \[options\]/);
  assert.match(stdout, /--interactive/);
  assert.match(stdout, /--yes, -y/);
  assert.match(stdout, /--data=<none\|drizzle\|kysely\|engine>/);
  assert.match(stdout, /--database=<postgres\|mysql\|sqlite\|mssql\|turso>/);
  assert.match(stdout, /With flags, the CLI can run fully non-interactively/);
  assert.match(stdout, /guides setup step by step in English/);
});

test('@rasono/web-memory prouve un adapter Web alternatif sans Rasengan', () => {
  const router = createWebRouter(createMemoryRouterAdapter(), {
    pages: [{ path: '/' }, { path: '/about' }],
  });

  assert.deepEqual(router, {
    adapter: 'memory',
    pages: [{ path: '/' }, { path: '/about' }],
  });
});
