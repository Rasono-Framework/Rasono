import type { Hono } from 'hono';
import type { Schema } from '@rasono/core';
import { parseJson } from './validate.js';
import type { RasonoRequestContext } from './types.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type RouteHandlerArgs<Deps, TBody> = {
  ctx: RasonoRequestContext<Deps>;
  body: TBody | undefined;
};

export type RouteDef<Deps, TBody> = {
  method: HttpMethod;
  path: string;
  body?: Schema<TBody>;
  handler: (c: any, args: RouteHandlerArgs<Deps, TBody>) => any | Promise<any>;
};

export function registerRoute<Deps, TBody>(app: Hono, def: RouteDef<Deps, TBody>): void {
  (app as any)[def.method](def.path, async (c: any) => {
    const ctx = c.get('rasono') as RasonoRequestContext<Deps>;
    const body = def.body ? ((await parseJson(c, def.body)) as TBody) : undefined;
    return def.handler(c, { ctx, body });
  });
}

export function registerRoutes<Deps>(app: Hono, defs: Array<RouteDef<Deps, any>>): void {
  for (const def of defs) {
    registerRoute(app, def);
  }
}
