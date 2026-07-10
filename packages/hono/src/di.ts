import type { RasonoRequestContext } from './types.js';

export type DepSelector<Deps, T> = (deps: Deps) => T;

export function useDep<Deps, T>(ctx: RasonoRequestContext<Deps>, selector: DepSelector<Deps, T>): T {
  return selector(ctx.deps);
}

