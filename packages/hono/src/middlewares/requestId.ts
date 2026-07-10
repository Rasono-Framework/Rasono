import type { MiddlewareHandler } from 'hono';

export function requestId(options?: { headerName?: string }): MiddlewareHandler {
  const headerName = options?.headerName ?? 'x-request-id';
  return async (c, next) => {
    const incoming = c.req.header(headerName);
    const id =
      incoming && incoming.trim().length > 0
        ? incoming.trim()
        : (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    c.set('requestId', id);
    await next();
    c.header(headerName, id);
  };
}
