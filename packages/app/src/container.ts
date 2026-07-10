export type DepScope = 'singleton' | 'request' | 'transient';

export type DepContext<Deps> = {
  mode: 'startup' | 'request';
  resolve: <K extends keyof Deps>(key: K) => Promise<Deps[K]>;
};

export type DepDefinition<Value, Deps> = {
  scope?: DepScope;
  eager?: boolean;
  create: (ctx: DepContext<Deps>) => Value | Promise<Value>;
  dispose?: (value: Value) => void | Promise<void>;
};

export type DepProviders<Deps> = Partial<{
  [K in keyof Deps]: DepDefinition<Deps[K], Deps>;
}>;

export type RequestScope<Deps> = {
  deps: Deps;
  dispose: () => Promise<void>;
};

export type DepOverrides<Deps> = Partial<Deps>;

export type RasonoContainer<Deps> = {
  resolveAppDeps: (options?: { overrides?: DepOverrides<Deps> }) => Promise<Deps>;
  createRequestScope: (options?: { overrides?: DepOverrides<Deps> }) => Promise<RequestScope<Deps>>;
  shutdown: () => Promise<void>;
};

type CreateContainerOptions<Deps> = {
  seed: Partial<Deps>;
  providers?: DepProviders<Deps>;
};

type DisposableEntry = {
  key: string;
  dispose: () => Promise<void>;
};

function keyName(key: PropertyKey): string {
  return typeof key === 'string' ? key : String(key);
}

async function runDisposers(entries: DisposableEntry[]): Promise<void> {
  const errors: unknown[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    try {
      await entries[index]!.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple dependency disposers failed');
  }
}

export function defineDep<Value, Deps>(definition: DepDefinition<Value, Deps>): DepDefinition<Value, Deps> {
  return definition;
}

export function createContainer<Deps extends Record<string, unknown>>(options: CreateContainerOptions<Deps>): RasonoContainer<Deps> {
  const providers = (options.providers ?? {}) as DepProviders<Deps>;
  const seed = options.seed as Partial<Record<keyof Deps, Deps[keyof Deps]>>;
  const keys = new Set<keyof Deps>([
    ...(Object.keys(seed) as Array<keyof Deps>),
    ...(Object.keys(providers) as Array<keyof Deps>),
  ]);

  const singletonValues = new Map<keyof Deps, unknown>();
  const singletonPromises = new Map<keyof Deps, Promise<unknown>>();
  const singletonDisposers: DisposableEntry[] = [];

  async function resolveKey(
    key: keyof Deps,
    mode: 'startup' | 'request',
    overrides: Partial<Record<keyof Deps, Deps[keyof Deps]>>,
    requestValues: Map<keyof Deps, unknown>,
    requestDisposers: DisposableEntry[],
    stack: Array<keyof Deps>,
  ): Promise<Deps[keyof Deps]> {
    if (stack.includes(key)) {
      const cycle = [...stack, key].map(keyName).join(' -> ');
      throw new Error(`Circular dependency detected: ${cycle}`);
    }

    if (key in overrides) {
      return overrides[key] as Deps[keyof Deps];
    }

    const provider = providers[key];
    if (!provider) {
      if (key in seed) {
        return seed[key] as Deps[keyof Deps];
      }
      throw new Error(`Missing dependency "${keyName(key)}"`);
    }

    const scope = provider.scope ?? 'singleton';
    if (scope === 'singleton') {
      if (singletonValues.has(key)) return singletonValues.get(key) as Deps[keyof Deps];
      if (!singletonPromises.has(key)) {
        const promise = Promise.resolve(
          provider.create({
            mode,
            resolve: async <K extends keyof Deps>(depKey: K) =>
              (await resolveKey(depKey, mode, overrides, requestValues, requestDisposers, [...stack, key])) as Deps[K],
          }),
        ).then((value) => {
          singletonValues.set(key, value);
          if (provider.dispose) {
            singletonDisposers.push({
              key: keyName(key),
              dispose: async () => {
                await provider.dispose?.(value as Deps[typeof key]);
              },
            });
          }
          return value;
        });
        singletonPromises.set(key, promise);
      }
      return (await singletonPromises.get(key)) as Deps[keyof Deps];
    }

    if (scope === 'request') {
      if (mode !== 'request') {
        throw new Error(`Request-scoped dependency "${keyName(key)}" cannot be resolved during startup`);
      }
      if (requestValues.has(key)) return requestValues.get(key) as Deps[keyof Deps];
      const value = await provider.create({
        mode,
        resolve: async <K extends keyof Deps>(depKey: K) =>
          (await resolveKey(depKey, mode, overrides, requestValues, requestDisposers, [...stack, key])) as Deps[K],
      });
      requestValues.set(key, value);
      if (provider.dispose) {
        requestDisposers.push({
          key: keyName(key),
          dispose: async () => {
            await provider.dispose?.(value);
          },
        });
      }
      return value as Deps[keyof Deps];
    }

    const transient = await provider.create({
      mode,
      resolve: async <K extends keyof Deps>(depKey: K) =>
        (await resolveKey(depKey, mode, overrides, requestValues, requestDisposers, [...stack, key])) as Deps[K],
    });
    if (provider.dispose) {
      requestDisposers.push({
        key: keyName(key),
        dispose: async () => {
          await provider.dispose?.(transient);
        },
      });
    }
    return transient as Deps[keyof Deps];
  }

  async function materialize(
    mode: 'startup' | 'request',
    targetKeys: Array<keyof Deps>,
    overrides: Partial<Record<keyof Deps, Deps[keyof Deps]>>,
    requestValues: Map<keyof Deps, unknown>,
    requestDisposers: DisposableEntry[],
  ): Promise<Deps> {
    const resolved: Partial<Record<keyof Deps, Deps[keyof Deps]>> = {};
    for (const key of targetKeys) {
      resolved[key] = (await resolveKey(key, mode, overrides, requestValues, requestDisposers, [])) as Deps[typeof key];
    }
    return resolved as Deps;
  }

  return {
    resolveAppDeps: async (options) => {
      const overrides = (options?.overrides ?? {}) as Partial<Record<keyof Deps, Deps[keyof Deps]>>;
      const requestValues = new Map<keyof Deps, unknown>();
      const requestDisposers: DisposableEntry[] = [];
      const startupKeys = Array.from(keys).filter((key) => {
        if (key in overrides || key in seed) return true;
        const provider = providers[key];
        return (provider?.scope ?? 'singleton') === 'singleton';
      });
      for (const key of Object.keys(providers) as Array<keyof Deps>) {
        const provider = providers[key];
        if ((provider?.scope ?? 'singleton') === 'singleton' && provider?.eager) {
          await resolveKey(key, 'startup', overrides, requestValues, requestDisposers, []);
        }
      }
      return materialize('startup', startupKeys, overrides, requestValues, requestDisposers);
    },
    createRequestScope: async (options) => {
      const overrides = (options?.overrides ?? {}) as Partial<Record<keyof Deps, Deps[keyof Deps]>>;
      const requestValues = new Map<keyof Deps, unknown>();
      const requestDisposers: DisposableEntry[] = [];
      const deps = await materialize('request', Array.from(keys), overrides, requestValues, requestDisposers);
      return {
        deps,
        dispose: async () => {
          await runDisposers(requestDisposers);
        },
      };
    },
    shutdown: async () => {
      await runDisposers(singletonDisposers);
    },
  };
}
