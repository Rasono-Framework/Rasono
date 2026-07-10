import type { MiddlewareHandler } from 'hono';
import { httpError } from '@rasono/core';
import { getClientIp } from '../ip.js';

type Bucket = {
  tokens: number;
  lastRefillMs: number;
  lastSeenMs: number;
};

type Store = {
  get: (key: string) => Bucket | undefined;
  set: (key: string, value: Bucket) => void;
  delete: (key: string) => void;
  size: () => number;
  keys: () => IterableIterator<string>;
};

function createMapStore(): Store {
  const m = new Map<string, Bucket>();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      m.delete(k);
      m.set(k, v);
    },
    delete: (k) => {
      m.delete(k);
    },
    size: () => m.size,
    keys: () => m.keys(),
  };
}

function evictIfNeeded(store: Store, maxEntries: number): void {
  while (store.size() > maxEntries) {
    const first = store.keys().next().value as string | undefined;
    if (!first) return;
    store.delete(first);
  }
}

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  burst?: number;
  trustProxy?: boolean;
  maxEntries?: number;
  key?: (c: any) => string;
};

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const capacity = options.burst ?? options.limit;
  const refillPerMs = options.limit / options.windowMs;
  const maxEntries = options.maxEntries ?? 50_000;
  const store = createMapStore();

  let hits = 0;

  return async (c, next) => {
    const now = Date.now();
    const key =
      options.key?.(c) ??
      (() => {
        const ip = getClientIp(
          {
            get: (h) => c.req.header(h),
          },
          { trustProxy: options.trustProxy }
        );
        return ip ? `ip:${ip}` : 'ip:unknown';
      })();

    hits += 1;
    if ((hits & 1023) === 0) {
      const cutoff = now - options.windowMs * 2;
      let swept = 0;
      for (const k of store.keys()) {
        const b = store.get(k);
        if (b && b.lastSeenMs < cutoff) store.delete(k);
        swept += 1;
        if (swept >= 256) break;
      }
    }

    const existing = store.get(key);
    const bucket: Bucket =
      existing ??
      ({
        tokens: capacity,
        lastRefillMs: now,
        lastSeenMs: now,
      } satisfies Bucket);

    const elapsed = Math.max(0, now - bucket.lastRefillMs);
    const refill = elapsed * refillPerMs;
    bucket.tokens = Math.min(capacity, bucket.tokens + refill);
    bucket.lastRefillMs = now;
    bucket.lastSeenMs = now;

    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
      store.set(key, bucket);
      evictIfNeeded(store, maxEntries);
      throw httpError(429, 'Too many requests', {
        code: 'RATE_LIMITED',
        headers: {
          'retry-after': String(retryAfterSeconds),
        },
      });
    }

    bucket.tokens -= 1;
    store.set(key, bucket);
    evictIfNeeded(store, maxEntries);

    await next();
  };
}

