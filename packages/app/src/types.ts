/**
 * This file defines the public application and module types used to wire the
 * Rasono runtime, lifecycle, and adapter contracts together.
 */
import type { DepOverrides, DepProviders, RasonoContainer } from './container.js';
import type { Principal, RasonoHttpAdapter, RasonoHttpApp, RasonoLogger } from '@rasono/core';

export type RasonoPlugin<Deps> = (app: RasonoApp<Deps>) => void | Promise<void>;

export type RasonoModuleProviders<Deps> = Partial<Deps> | ((deps: Deps) => Partial<Deps>);

export type RasonoModule<Deps> = {
  name: string;
  providers?: RasonoModuleProviders<Deps>;
  dependencies?: DepProviders<Deps>;
  setup?: (app: RasonoApp<Deps>) => void | Promise<void>;
  startup?: (ctx: RasonoLifecycleContext<Deps>) => void | Promise<void>;
  shutdown?: (ctx: RasonoLifecycleContext<Deps>) => void | Promise<void>;
};

export type CreateAppOptions<Deps, AdapterOptions = unknown> = {
  deps?: Partial<Deps>;
  dependencies?: DepProviders<Deps>;
  overrides?: DepOverrides<Deps>;
  transport: {
    adapter: RasonoHttpAdapter<Deps, AdapterOptions>;
    options?: AdapterOptions;
  };
  modules?: Array<RasonoModule<Deps>>;
  plugins?: Array<RasonoPlugin<Deps>>;
  resolvePrincipal?: (input: {
    request: Request;
    requestId: string;
    log: RasonoLogger;
    deps: Deps;
  }) => Principal | undefined | Promise<Principal | undefined>;
  startup?: (ctx: RasonoLifecycleContext<Deps>) => void | Promise<void>;
  shutdown?: (ctx: RasonoLifecycleContext<Deps>) => void | Promise<void>;
};

export type AppMethods = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'use' | 'route' | 'on' | 'notFound' | 'onError';

export type RasonoLifecycleContext<Deps> = {
  app: RasonoApp<Deps>;
  deps: Deps;
  container: RasonoContainer<Deps>;
};

export type RasonoApp<Deps> = {
  ready: Promise<void>;
  close: () => Promise<void>;
  container: RasonoContainer<Deps>;
} & RasonoHttpApp<Deps>;
