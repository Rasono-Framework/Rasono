import { HTTPException } from 'hono/http-exception';
import type { Hono } from 'hono';
import { appErrors, HttpError, isAppError } from '@rasono/core';
import type { RasonoLogger } from '../types.js';

export function installErrorHandlers(
  app: Hono<any, any, any>,
  options?: {
    logger?: RasonoLogger;
    exposeUnexpectedErrorMessage?: boolean;
  }
): void {
  const logger: RasonoLogger =
    options?.logger ??
    ({
      info: (data, message) => console.info(message ?? '', data),
      warn: (data, message) => console.warn(message ?? '', data),
      error: (data, message) => console.error(message ?? '', data),
    } satisfies RasonoLogger);

  app.notFound((c) => {
    const requestId = c.get('requestId') as string | undefined;
    const body = appErrors.notFound().toPublicShape(requestId);
    return c.json(body, 404);
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId') as string | undefined;

    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    if (err instanceof HttpError) {
      if (err.headers) {
        for (const [k, v] of Object.entries(err.headers)) {
          c.header(k, String(v));
        }
      }
      return c.json(err.toPublicShape(requestId), err.status as any);
    }

    if (isAppError(err)) {
      return c.json(err.toPublicShape(requestId), err.status as any);
    }

    logger.error(
      {
        requestId,
        errName: err instanceof Error ? err.name : 'NonErrorThrown',
        errMessage: err instanceof Error ? err.message : String(err),
      },
      'Unhandled error'
    );

    const unexpected = appErrors.unexpected(err);
    const body = unexpected.toPublicShape(requestId);

    if (options?.exposeUnexpectedErrorMessage && err instanceof Error) {
      return c.json({ ...body, message: err.message }, 500);
    }

    return c.json(body, 500);
  });
}
