import type { Schema } from '@rasono/core';
import { appErrors } from '@rasono/core';

export type ApiClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  json?: unknown;
};

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

function toQueryString(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

export function createApiClient(options: ApiClientOptions) {
  const fetcher = options.fetch ?? fetch;

  return {
    async request<T>(request: RequestOptions, responseSchema?: Schema<T>): Promise<T> {
      const url = `${joinUrl(options.baseUrl, request.path)}${toQueryString(request.query)}`;
      const response = await fetcher(url, {
        method: request.method ?? 'GET',
        headers: {
          ...(request.json ? { 'content-type': 'application/json' } : {}),
          ...(options.headers ?? {}),
          ...(request.headers ?? {}),
        },
        body: request.json ? JSON.stringify(request.json) : undefined,
      });

      if (!response.ok) {
        throw appErrors.unexpected(new Error(`HTTP ${response.status}`));
      }

      if (!responseSchema) {
        return (await response.json()) as T;
      }

      try {
        return responseSchema.parse(await response.json());
      } catch (error) {
        throw appErrors.unexpected(error);
      }
    },
  };
}
