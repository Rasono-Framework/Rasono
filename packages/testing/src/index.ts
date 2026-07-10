import { createApp } from '@rasono/app';
import type { CreateAppOptions, RasonoApp } from '@rasono/app';

export type TestQueryValue = string | number | boolean | null | undefined;

export type TestRequestOptions = {
  method?: string;
  query?: Record<string, TestQueryValue | TestQueryValue[]>;
  headers?: Record<string, string>;
  json?: unknown;
  body?: BodyInit | null;
};

export type TestAppOptions<Deps extends Record<string, unknown>, AdapterOptions = unknown> = CreateAppOptions<Deps, AdapterOptions> & {
  setup?: (app: RasonoApp<Deps>) => void | Promise<void>;
};

export type TestClient = {
  request: (path: string, options?: TestRequestOptions) => Promise<Response>;
  get: (path: string, options?: Omit<TestRequestOptions, 'method'>) => Promise<Response>;
  post: (path: string, options?: Omit<TestRequestOptions, 'method'>) => Promise<Response>;
  put: (path: string, options?: Omit<TestRequestOptions, 'method'>) => Promise<Response>;
  patch: (path: string, options?: Omit<TestRequestOptions, 'method'>) => Promise<Response>;
  delete: (path: string, options?: Omit<TestRequestOptions, 'method'>) => Promise<Response>;
};

export type TestApp<Deps extends Record<string, unknown>> = {
  app: RasonoApp<Deps>;
  client: TestClient;
  close: () => Promise<void>;
};

function appendQuery(url: URL, query: Record<string, TestQueryValue | TestQueryValue[]> | undefined): void {
  if (!query) return;
  for (const [key, raw] of Object.entries(query)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value === 'undefined' || value === null) continue;
      url.searchParams.append(key, String(value));
    }
  }
}

function buildRequest(path: string, options?: TestRequestOptions): Request {
  const url = new URL(path, 'http://rasono.test');
  appendQuery(url, options?.query);
  const headers = new Headers(options?.headers ?? {});
  let body = options?.body;
  if (typeof options?.json !== 'undefined') {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    body = JSON.stringify(options.json);
  }
  return new Request(url, {
    method: options?.method ?? 'GET',
    headers,
    body,
  });
}

export function createTestClient(fetchHandler: (request: Request) => Promise<Response>): TestClient {
  const request = async (path: string, options?: TestRequestOptions): Promise<Response> => {
    return fetchHandler(buildRequest(path, options));
  };

  return {
    request,
    get: (path, options) => request(path, { ...(options ?? {}), method: 'GET' }),
    post: (path, options) => request(path, { ...(options ?? {}), method: 'POST' }),
    put: (path, options) => request(path, { ...(options ?? {}), method: 'PUT' }),
    patch: (path, options) => request(path, { ...(options ?? {}), method: 'PATCH' }),
    delete: (path, options) => request(path, { ...(options ?? {}), method: 'DELETE' }),
  };
}

export async function createTestApp<Deps extends Record<string, unknown>, AdapterOptions = unknown>(options: TestAppOptions<Deps, AdapterOptions>): Promise<TestApp<Deps>> {
  const { setup, ...appOptions } = options;
  const app = createApp<Deps, AdapterOptions>(appOptions);
  await setup?.(app);
  await app.ready;

  return {
    app,
    client: createTestClient((request) => Promise.resolve(app.fetch(request))),
    close: () => app.close(),
  };
}
