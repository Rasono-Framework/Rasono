/**
 * This file defines the declarative route contract used by handlers, input
 * validation, authorization checks, and response serialization.
 */
import { appErrors, type OpenApiSchema, type Principal, type RasonoRequestContext, type Schema } from '@rasono/core';

export type ApiMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type ApiErrorDef = {
  status: number;
  code: string;
  description?: string;
  detail?: string;
  example?: unknown;
};

export type ApiErrorMode = 'merge' | 'replace';

export type OpenApiExampleDef = {
  summary?: string;
  description?: string;
  value: unknown;
};

export type OpenApiParameterDoc = {
  description?: string;
  example?: unknown;
  deprecated?: boolean;
};

export type RouteRequestBodyDef = {
  description?: string;
  required?: boolean;
  contentType?: string;
  examples?: Record<string, OpenApiExampleDef>;
};

export type RouteExternalDocsDef = {
  description?: string;
  url: string;
};

export type RouteOpenApiDef = {
  params?: Record<string, OpenApiParameterDoc>;
  query?: Record<string, OpenApiParameterDoc>;
  headers?: Record<string, OpenApiParameterDoc>;
  cookies?: Record<string, OpenApiParameterDoc>;
  requestBody?: RouteRequestBodyDef;
  externalDocs?: RouteExternalDocsDef;
  security?: Array<Record<string, string[]>>;
};

export type RouteInputDef<TBody = unknown, TQuery = unknown, TParams = unknown, THeaders = unknown, TCookies = unknown> = {
  body?: Schema<TBody>;
  query?: Schema<TQuery>;
  params?: Schema<TParams>;
  headers?: Schema<THeaders>;
  cookies?: Schema<TCookies>;
};

export type RouteInputValue<TBody = unknown, TQuery = unknown, TParams = unknown, THeaders = unknown, TCookies = unknown> = {
  body: TBody | undefined;
  query: TQuery | undefined;
  params: TParams | undefined;
  headers: THeaders | undefined;
  cookies: TCookies | undefined;
};

export type RouteAuthDef = {
  required?: boolean;
  roles?: string[];
  scheme?: 'bearer' | 'session' | 'apiKey';
};

export type RouteHandlerArgs<Deps, TBody = unknown, TQuery = unknown, TParams = unknown, THeaders = unknown, TCookies = unknown> = {
  ctx: RasonoRequestContext<Deps>;
  deps: Deps;
  principal?: Principal;
  input: RouteInputValue<TBody, TQuery, TParams, THeaders, TCookies>;
};

export type RoutePolicy<
  Deps,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
  TCookies = unknown,
> = (
  args: RouteHandlerArgs<Deps, TBody, TQuery, TParams, THeaders, TCookies>,
) => boolean | void | Promise<boolean | void>;

export type RouteResponseDef<TOutput = unknown> = {
  status?: number;
  description?: string;
  contentType?: string;
  headers?: Record<string, OpenApiSchema>;
  schema?: Schema<TOutput>;
  examples?: Record<string, OpenApiExampleDef>;
};

export type ApiRouteDef<
  Deps = unknown,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
  TCookies = unknown,
  TOutput = unknown,
> = {
  method: ApiMethod;
  path?: string;
  handler: (c: any, args: RouteHandlerArgs<Deps, TBody, TQuery, TParams, THeaders, TCookies>) => any | Promise<any>;
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  deprecated?: boolean;
  input?: RouteInputDef<TBody, TQuery, TParams, THeaders, TCookies>;
  output?: Schema<TOutput>;
  response?: RouteResponseDef<TOutput>;
  auth?: RouteAuthDef;
  openapi?: RouteOpenApiDef;
  policy?: RoutePolicy<Deps, TBody, TQuery, TParams, THeaders, TCookies>;
  errors?: ApiErrorDef[];
  errorMode?: ApiErrorMode;
};

export type ApiRoute = ApiRouteDef<any, any, any, any, any, any, any>;

function parseWithSchema<T>(schema: Schema<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    throw appErrors.validation(error);
  }
}

function headersToObject(req: any): Record<string, string> {
  const rawHeaders = req?.raw?.headers;
  if (rawHeaders && typeof rawHeaders.entries === 'function') {
    const headers: Record<string, string> = {};
    for (const [key, value] of rawHeaders.entries() as Iterable<[string, string]>) {
      headers[String(key)] = String(value);
    }
    return headers;
  }
  if (typeof req?.header === 'function') {
    try {
      const headers = req.header();
      if (headers && typeof headers === 'object') {
        return Object.fromEntries(
          Object.entries(headers as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]),
        );
      }
    } catch {
      return {};
    }
  }
  return {};
}

function queryToObject(req: any): Record<string, string | string[]> {
  const rawUrl = typeof req?.url === 'string' ? req.url : req?.raw?.url;
  if (!rawUrl) return {};
  const searchParams = new URL(rawUrl, 'http://localhost').searchParams;
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
      continue;
    }
    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }
    query[key] = [existing, value];
  }
  return query;
}

function paramsToObject(c: any): Record<string, string> {
  if (typeof c?.req?.param !== 'function') return {};
  try {
    const params = c.req.param();
    if (params && typeof params === 'object') {
      return { ...(params as Record<string, string>) };
    }
  } catch {
    return {};
  }
  return {};
}

async function bodyToValue(c: any): Promise<unknown> {
  try {
    return await c.req.json();
  } catch (error) {
    throw appErrors.validation(error);
  }
}

function cookiesToObject(req: any): Record<string, string> {
  const cookieHeader = headersToObject(req).cookie;
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const entry of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = entry.split('=');
    const name = rawName?.trim();
    if (!name) continue;
    cookies[name] = rawValue.join('=').trim();
  }
  return cookies;
}

function ensureAuthorized(principal: Principal | undefined, auth: RouteAuthDef | undefined): void {
  if (!auth) return;
  const requiredRoles = auth.roles?.filter(Boolean) ?? [];
  const authRequired = auth.required ?? requiredRoles.length > 0;
  if (authRequired && !principal) throw appErrors.authRequired();
  if (!principal) return;
  if (requiredRoles.length === 0) return;
  const granted = new Set(principal.roles ?? []);
  if (!requiredRoles.every((role) => granted.has(role))) {
    throw appErrors.forbidden();
  }
}

async function resolveRouteInput<TBody, TQuery, TParams, THeaders, TCookies>(
  c: any,
  input: RouteInputDef<TBody, TQuery, TParams, THeaders, TCookies> | undefined,
): Promise<RouteInputValue<TBody, TQuery, TParams, THeaders, TCookies>> {
  return {
    body: input?.body ? parseWithSchema(input.body, await bodyToValue(c)) : undefined,
    query: input?.query ? parseWithSchema(input.query, queryToObject(c.req)) : undefined,
    params: input?.params ? parseWithSchema(input.params, paramsToObject(c)) : undefined,
    headers: input?.headers ? parseWithSchema(input.headers, headersToObject(c.req)) : undefined,
    cookies: input?.cookies ? parseWithSchema(input.cookies, cookiesToObject(c.req)) : undefined,
  };
}

async function ensureRoutePolicy<
  Deps,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
  TCookies = unknown,
>(
  policy: RoutePolicy<Deps, TBody, TQuery, TParams, THeaders, TCookies> | undefined,
  args: RouteHandlerArgs<Deps, TBody, TQuery, TParams, THeaders, TCookies>,
): Promise<void> {
  if (!policy) return;
  const allowed = await policy(args);
  if (allowed === false) {
    throw appErrors.forbidden();
  }
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== 'undefined' && value instanceof Response;
}

function resolveRouteSchema<TOutput>(
  route: Pick<ApiRouteDef<any, any, any, any, any, any, TOutput>, 'output' | 'response'>,
): Schema<TOutput> | undefined {
  return route.response?.schema ?? route.output;
}

async function serializeRouteResult<TOutput>(
  c: any,
  result: unknown,
  route: Pick<ApiRouteDef<any, any, any, any, any, any, TOutput>, 'output' | 'response'>,
): Promise<Response> {
  if (isResponse(result)) return result;
  const schema = resolveRouteSchema(route);
  const responseStatus = route.response?.status;
  const contentType = route.response?.contentType ?? 'application/json';
  if (typeof result === 'undefined') {
    return c.body(null, responseStatus ?? 204);
  }
  const payload = schema ? parseWithSchema(schema, result) : result;
  if (contentType === 'application/json') {
    return c.json(payload, responseStatus);
  }
  return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status: responseStatus ?? 200,
    headers: { 'content-type': contentType },
  });
}

export function defineRoute<
  Deps = unknown,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
  TCookies = unknown,
  TOutput = unknown,
>(
  def: ApiRouteDef<Deps, TBody, TQuery, TParams, THeaders, TCookies, TOutput>,
): ApiRouteDef<Deps, TBody, TQuery, TParams, THeaders, TCookies, TOutput> {
  return def;
}

export function defineApi<
  Deps = unknown,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
  TCookies = unknown,
  TOutput = unknown,
>(
  def: ApiRouteDef<Deps, TBody, TQuery, TParams, THeaders, TCookies, TOutput>,
): ApiRouteDef<Deps, TBody, TQuery, TParams, THeaders, TCookies, TOutput> {
  return defineRoute(def);
}

export function definePolicy<
  Deps,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
  TCookies = unknown,
>(
  policy: RoutePolicy<Deps, TBody, TQuery, TParams, THeaders, TCookies>,
): RoutePolicy<Deps, TBody, TQuery, TParams, THeaders, TCookies> {
  return policy;
}

export function composePolicies<
  Deps,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
  TCookies = unknown,
>(
  policies: Array<RoutePolicy<Deps, TBody, TQuery, TParams, THeaders, TCookies>>,
): RoutePolicy<Deps, TBody, TQuery, TParams, THeaders, TCookies> {
  return async (args) => {
    for (const policy of policies) {
      const allowed = await policy(args);
      if (allowed === false) return false;
    }
    return true;
  };
}

export function installApiRoute<
  Deps,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
  TCookies = unknown,
  TOutput = unknown,
>(
  app: any,
  path: string | undefined,
  route: ApiRouteDef<Deps, TBody, TQuery, TParams, THeaders, TCookies, TOutput>,
): void {
  const targetPath = path ?? route.path;
  if (!targetPath) {
    throw new Error('installApiRoute requires an explicit path or a route.path value');
  }

  app[route.method](targetPath, async (c: any) => {
    const ctx = c.get('rasono') as RasonoRequestContext<Deps>;
    if (!ctx) {
      throw new Error('Rasono request context is missing. Did you create the app with createApp()?');
    }
    ensureAuthorized(ctx.principal, route.auth);
    const input = await resolveRouteInput(c, route.input);
    const handlerArgs = {
      ctx,
      deps: ctx.deps,
      principal: ctx.principal,
      input,
    };
    await ensureRoutePolicy(route.policy, handlerArgs);
    const result = await route.handler(c, handlerArgs);
    return serializeRouteResult(c, result, route);
  });
}

export function defineErrors<const T extends ApiErrorDef[]>(errors: T): T {
  return errors;
}
