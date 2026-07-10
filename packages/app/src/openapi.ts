/**
 * This file builds OpenAPI documents from declarative Rasono routes so the
 * framework can expose a richer and reusable contract surface.
 */
import type {
  ApiErrorDef,
  ApiRoute,
  OpenApiExampleDef,
  OpenApiParameterDoc,
  RouteResponseDef,
} from './route-definitions.js';

export type GeneratedOpenApiRoute = {
  file: string;
  path: string;
  route: ApiRoute;
};

function getSchemaDoc(schema: unknown, fallback?: any): any {
  if (!schema || typeof schema !== 'object') return fallback;
  const openapi = (schema as { openapi?: unknown }).openapi;
  return openapi && typeof openapi === 'object' ? openapi : fallback;
}

function formatExamples(examples: Record<string, OpenApiExampleDef> | undefined): Record<string, any> | undefined {
  if (!examples) return undefined;
  const entries = Object.entries(examples);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.map(([name, example]) => [
      name,
      {
        ...(example.summary ? { summary: example.summary } : {}),
        ...(example.description ? { description: example.description } : {}),
        value: example.value,
      },
    ]),
  );
}

function pathParamsFromRoute(path: string): string[] {
  const matches = path.match(/:([A-Za-z0-9_]+)/g) ?? [];
  return matches.map((value) => value.slice(1));
}

function schemaPropertiesToParameters(
  schema: unknown,
  location: 'query' | 'header' | 'path' | 'cookie',
  docs?: Record<string, OpenApiParameterDoc>,
): any[] {
  const doc = getSchemaDoc(schema);
  if (!doc || typeof doc !== 'object') return [];
  const properties = typeof doc.properties === 'object' && doc.properties ? (doc.properties as Record<string, any>) : {};
  const required = new Set(Array.isArray(doc.required) ? doc.required.map((value: unknown) => String(value)) : []);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' ? true : required.has(name),
    schema: property,
    ...(docs?.[name]?.description ? { description: docs[name]?.description } : {}),
    ...(typeof docs?.[name]?.example !== 'undefined' ? { example: docs[name]?.example } : {}),
    ...(typeof docs?.[name]?.deprecated === 'boolean' ? { deprecated: docs[name]?.deprecated } : {}),
  }));
}

function getPathParameters(route: GeneratedOpenApiRoute): any[] {
  const explicit = schemaPropertiesToParameters(route.route.input?.params, 'path', route.route.openapi?.params);
  if (explicit.length > 0) return explicit;
  return pathParamsFromRoute(route.path).map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
    ...(route.route.openapi?.params?.[name]?.description ? { description: route.route.openapi.params[name]?.description } : {}),
    ...(typeof route.route.openapi?.params?.[name]?.example !== 'undefined'
      ? { example: route.route.openapi.params[name]?.example }
      : {}),
    ...(typeof route.route.openapi?.params?.[name]?.deprecated === 'boolean'
      ? { deprecated: route.route.openapi.params[name]?.deprecated }
      : {}),
  }));
}

function getSecurity(route: ApiRoute): any[] | undefined {
  if (route.openapi?.security) return route.openapi.security;
  if (!route.auth) return undefined;
  if (route.auth.scheme === 'apiKey') return [{ apiKeyAuth: [] }];
  if (route.auth.scheme === 'session') return [{ sessionAuth: [] }];
  return [{ bearerAuth: [] }];
}

function getSuccessStatus(route: ApiRoute): number {
  return route.response?.status ?? 200;
}

function getSuccessContentType(route: ApiRoute): string {
  return route.response?.contentType ?? 'application/json';
}

function getResponseSchema(route: ApiRoute): any {
  return getSchemaDoc(route.response?.schema ?? route.output, { type: 'object' });
}

function normalizeResponseHeaders(headers: RouteResponseDef['headers']): Record<string, any> | undefined {
  if (!headers) return undefined;
  const entries = Object.entries(headers);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([name, schema]) => [name, { schema }]));
}

function buildRequestBody(route: ApiRoute): any | undefined {
  if (!route.input?.body) return undefined;
  const contentType = route.openapi?.requestBody?.contentType ?? 'application/json';
  const examples = formatExamples(route.openapi?.requestBody?.examples);
  return {
    ...(route.openapi?.requestBody?.description ? { description: route.openapi.requestBody.description } : {}),
    required: route.openapi?.requestBody?.required ?? true,
    content: {
      [contentType]: {
        schema: getSchemaDoc(route.input.body, { type: 'object' }),
        ...(examples ? { examples } : {}),
      },
    },
  };
}

function buildSuccessResponse(route: ApiRoute): Record<string, any> {
  const contentType = getSuccessContentType(route);
  const headers = normalizeResponseHeaders(route.response?.headers);
  const examples = formatExamples(route.response?.examples);
  const response: Record<string, any> = {
    description: route.response?.description ?? 'Success',
    ...(headers ? { headers } : {}),
  };
  if (route.response?.schema ?? route.output) {
    response.content = {
      [contentType]: {
        schema: getResponseSchema(route),
        ...(examples ? { examples } : {}),
      },
    };
  }
  return response;
}

function buildErrorResponses(errors: ApiErrorDef[]): Record<string, any> {
  const errorSchema = {
    type: 'object',
    properties: {
      code: { type: 'string' },
      message: { type: 'string' },
      detail: { type: 'string' },
      requestId: { type: 'string' },
    },
    additionalProperties: false,
  };

  const errorsByStatus = new Map<number, ApiErrorDef[]>();
  for (const error of errors) {
    const bucket = errorsByStatus.get(error.status) ?? [];
    bucket.push(error);
    errorsByStatus.set(error.status, bucket);
  }

  const responses: Record<string, any> = {};
  for (const [status, defs] of errorsByStatus.entries()) {
    const examples: Record<string, any> = {};
    for (const def of defs) {
      examples[def.code] = {
        summary: def.description ?? def.code,
        value:
          typeof def.example !== 'undefined'
            ? def.example
            : { code: def.code, detail: def.detail ?? def.description ?? def.code },
      };
    }
    responses[String(status)] = {
      description: defs.map((def) => `${def.code}${def.description ? ` - ${def.description}` : ''}`).join(' | '),
      content: { 'application/json': { schema: errorSchema, examples } },
      'x-rasono-errors': defs.map((def) => ({
        code: def.code,
        description: def.description,
        detail: def.detail,
      })),
    };
  }
  return responses;
}

export function buildOpenApiDocument(routes: GeneratedOpenApiRoute[], info: { title: string; version: string }): any {
  const standardErrors: ApiErrorDef[] = [
    { status: 400, code: 'BAD_REQUEST', description: 'Bad Request', detail: 'Invalid request' },
    { status: 401, code: 'AUTH_REQUIRED', description: 'Unauthorized', detail: 'Authentication required' },
    { status: 403, code: 'FORBIDDEN', description: 'Forbidden', detail: 'Forbidden' },
    { status: 404, code: 'NOT_FOUND', description: 'Not Found', detail: 'Not found' },
    { status: 409, code: 'CONFLICT', description: 'Conflict', detail: 'Conflict' },
    { status: 429, code: 'RATE_LIMITED', description: 'Too Many Requests', detail: 'Too many requests' },
    { status: 500, code: 'INTERNAL_ERROR', description: 'Internal Server Error', detail: 'Internal server error' },
  ];

  const mergeErrors = (entry: GeneratedOpenApiRoute) => {
    const route = entry.route;
    const base = route.errorMode === 'replace' ? [] : [...standardErrors];
    const custom = route.errors ?? [];
    const byKey = new Map<string, ApiErrorDef>();
    for (const error of base) byKey.set(`${error.status}:${error.code}`, { ...error });
    for (const error of custom) {
      const key = `${error.status}:${error.code}`;
      const prev = byKey.get(key);
      byKey.set(key, { ...(prev ?? {}), ...error });
    }
    return Array.from(byKey.values());
  };

  const paths: Record<string, any> = {};
  for (const entry of routes) {
    const route = entry.route;
    const method = route.method.toLowerCase();
    if (!paths[entry.path]) paths[entry.path] = {};

    const parameters = [
      ...getPathParameters(entry),
      ...schemaPropertiesToParameters(route.input?.query, 'query', route.openapi?.query),
      ...schemaPropertiesToParameters(route.input?.headers, 'header', route.openapi?.headers),
      ...schemaPropertiesToParameters(route.input?.cookies, 'cookie', route.openapi?.cookies),
    ];
    const requestBody = buildRequestBody(route);
    const security = getSecurity(route);

    const responses = {
      [String(getSuccessStatus(route))]: buildSuccessResponse(route),
      ...buildErrorResponses(mergeErrors(entry)),
    };

    paths[entry.path][method] = {
      operationId: route.operationId,
      summary: route.summary,
      description: route.description,
      tags: route.tags,
      deprecated: route.deprecated,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      ...(security ? { security } : {}),
      ...(route.openapi?.externalDocs ? { externalDocs: route.openapi.externalDocs } : {}),
      ...(route.policy ? { 'x-rasono-authz': { hasPolicy: true, roles: route.auth?.roles ?? [] } } : {}),
      responses,
    };
  }

  return {
    openapi: '3.1.0',
    info,
    paths,
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            detail: { type: 'string' },
            requestId: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        sessionAuth: { type: 'apiKey', in: 'cookie', name: 'session' },
      },
    },
  };
}
