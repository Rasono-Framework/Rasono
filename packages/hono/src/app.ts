import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { HttpCommonOptions, RasonoHttpAdapter, ResolvedRequestContext, RasonoLogger, RasonoRequestContext } from '@rasono/core';
import { installErrorHandlers } from './middlewares/errorHandler.js';
import { requestId } from './middlewares/requestId.js';
import { createBackgroundTasks, runBackgroundTasksSafely } from './background.js';
import { createConsoleLogger } from './logger.js';
import { rateLimit } from './middlewares/rateLimit.js';

type Variables<Deps> = {
  requestId: string;
  rasono: RasonoRequestContext<Deps>;
};

export type RasonoHonoApp<Deps> = Hono<{ Variables: Variables<Deps> }>;

function defaultLogger(): RasonoLogger {
  return createConsoleLogger({ pretty: true, colors: true });
}

export type HonoAdapterOptions = {
  rateLimit?: {
    enabled?: boolean;
    limit?: number;
    windowMs?: number;
    burst?: number;
    trustProxy?: boolean;
    maxEntries?: number;
  };
};

export type CreateRasonoAppOptions<Deps> = HttpCommonOptions<Deps> & {
  adapterOptions?: HonoAdapterOptions;
};

function getWaitUntil(c: unknown): ((promise: Promise<unknown>) => void) | undefined {
  try {
    const executionCtx = (c as { executionCtx?: { waitUntil?: (promise: Promise<unknown>) => void } }).executionCtx;
    if (typeof executionCtx?.waitUntil === 'function') {
      return executionCtx.waitUntil.bind(executionCtx);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function createRasonoApp<Deps>(options: CreateRasonoAppOptions<Deps>): RasonoHonoApp<Deps> {
  const app = new Hono<{ Variables: Variables<Deps> }>();
  const logger = options.logger ?? defaultLogger();

  app.use(
    '*',
    requestId({
      headerName: options.requestIdHeaderName ?? 'x-request-id',
    }) as MiddlewareHandler
  );

  const rl = options.adapterOptions?.rateLimit ?? {};
  const rateLimitEnabled = rl.enabled ?? true;
  if (rateLimitEnabled) {
    app.use(
      '*',
      rateLimit({
        limit: rl.limit ?? 300,
        windowMs: rl.windowMs ?? 60_000,
        burst: rl.burst,
        trustProxy: rl.trustProxy ?? false,
        maxEntries: rl.maxEntries,
      }) as MiddlewareHandler
    );
  }

  const accessLogEnabled = options.accessLog ?? true;
  if (accessLogEnabled) {
    app.use('*', async (c, next) => {
      const start = Date.now();
      await next();
      const durationMs = Date.now() - start;
      const requestId = c.get('requestId');
      logger.info(
        {
          requestId,
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs,
        },
        'request'
      );
    });
  }

  app.use('*', async (c, next) => {
    const reqId = c.get('requestId');
    const tasks = createBackgroundTasks();
    const resolved =
      (await options.resolveRequestContext?.({
        requestId: reqId,
        log: logger,
        request: c.req.raw,
      })) ??
      ({
        deps: options.deps as Deps,
      } satisfies ResolvedRequestContext<Deps>);
    if (typeof resolved.deps === 'undefined') {
      throw new Error('Rasono request context resolution returned no deps');
    }
    c.set('rasono', {
      deps: resolved.deps,
      requestId: reqId,
      log: logger,
      ...(resolved.principal ? { principal: resolved.principal } : {}),
      tasks,
    });
    const waitUntil = getWaitUntil(c);
    try {
      await next();
    } finally {
      const background = runBackgroundTasksSafely({
        tasks,
        requestId: reqId,
        log: logger,
        waitUntil,
      });
      const dispose = Promise.resolve(background).finally(async () => {
        await resolved.dispose?.();
      });
      if (waitUntil) {
        waitUntil(dispose);
      } else {
        await dispose;
      }
    }
  });

  installErrorHandlers(app, {
    logger,
    exposeUnexpectedErrorMessage: options.exposeUnexpectedErrorMessage,
  });

  return app;
}

export function createHonoAdapter<Deps>(): RasonoHttpAdapter<Deps, HonoAdapterOptions> {
  return {
    name: 'hono',
    create: (options: HttpCommonOptions<Deps> & { adapterOptions?: HonoAdapterOptions }) =>
      createRasonoApp({
        ...options,
      }),
  };
}

export function getRasonoContext<Deps>(c: { get: (key: 'rasono') => RasonoRequestContext<Deps> }): RasonoRequestContext<Deps> {
  return c.get('rasono');
}
