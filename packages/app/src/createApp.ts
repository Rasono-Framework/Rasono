import { createContainer, type DepProviders, type RasonoContainer } from './container.js';
import type { CreateAppOptions, RasonoApp, RasonoLifecycleContext, RasonoModule, RasonoModuleProviders } from './types.js';

function mergeModuleValues<Deps>(deps: Partial<Deps>, providers: RasonoModuleProviders<Deps> | undefined): Partial<Deps> {
  if (!providers) return deps;
  const patch = typeof providers === 'function' ? providers(deps as Deps) : providers;
  return { ...(deps as Record<string, unknown>), ...(patch as Record<string, unknown>) } as Partial<Deps>;
}

function mergeModuleDependencies<Deps>(base: DepProviders<Deps>, modules: Array<RasonoModule<Deps>>): DepProviders<Deps> {
  const merged: DepProviders<Deps> = { ...base };
  for (const module of modules) {
    for (const key of Object.keys(module.dependencies ?? {}) as Array<keyof Deps>) {
      if (key in merged) {
        throw new Error(`Duplicate dependency provider "${String(key)}" declared in module "${module.name}"`);
      }
      const provider = module.dependencies?.[key];
      if (provider) merged[key] = provider;
    }
  }
  return merged;
}

function wrap<Deps>(transportApp: any, container: RasonoContainer<Deps>): RasonoApp<Deps> {
  const app: any = {};
  app.container = container;
  app.fetch = transportApp.fetch.bind(transportApp);
  app.close = async () => {};
  for (const k of ['get', 'post', 'put', 'patch', 'delete', 'use', 'route'] as const) {
    app[k] = (...args: any[]) => {
      transportApp[k](...args);
      return app;
    };
  }
  app.ready = Promise.resolve();
  return app as RasonoApp<Deps>;
}

export function createApp<Deps extends Record<string, unknown>, AdapterOptions = unknown>(options: CreateAppOptions<Deps, AdapterOptions>): RasonoApp<Deps> {
  const modules = options.modules ?? [];
  const appOverrides = options.overrides ?? {};
  let seed = { ...(options.deps ?? {}) } as Partial<Deps>;
  for (const module of modules) {
    seed = mergeModuleValues(seed, module.providers);
  }

  const container = createContainer<Deps>({
    seed,
    providers: mergeModuleDependencies(options.dependencies ?? {}, modules),
  });

  const transportApp = options.transport.adapter.create({
    adapterOptions: options.transport.options,
    resolveRequestContext: async ({ request, requestId, log }: { request: Request; requestId: string; log: { info: (data: Record<string, unknown>, message?: string) => void; warn: (data: Record<string, unknown>, message?: string) => void; error: (data: Record<string, unknown>, message?: string) => void } }) => {
      const scope = await container.createRequestScope({ overrides: appOverrides });
      const principal = await options.resolvePrincipal?.({
        request,
        requestId,
        log,
        deps: scope.deps,
      });
      return {
        deps: scope.deps,
        ...(principal ? { principal } : {}),
        dispose: scope.dispose,
      };
    },
  } as any);

  const app = wrap<Deps>(transportApp, container);

  const createLifecycleContext = async (): Promise<RasonoLifecycleContext<Deps>> => ({
    app,
    deps: await container.resolveAppDeps({ overrides: appOverrides }),
    container,
  });

  app.ready = (async () => {
    for (const m of modules) {
      await m.setup?.(app);
    }
    for (const p of options.plugins ?? []) {
      await p(app);
    }
    const lifecycle = await createLifecycleContext();
    for (const m of modules) {
      await m.startup?.(lifecycle);
    }
    await options.startup?.(lifecycle);
  })();

  app.close = async () => {
    await app.ready;
    const lifecycle = await createLifecycleContext();
    const errors: unknown[] = [];
    try {
      await options.shutdown?.(lifecycle);
    } catch (error) {
      errors.push(error);
    }
    for (let index = modules.length - 1; index >= 0; index -= 1) {
      try {
        await modules[index]!.shutdown?.(lifecycle);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await container.shutdown();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Rasono app shutdown failed');
  };

  return app;
}
