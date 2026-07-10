/**
 * This file exposes the public helper used to define app modules with a stable
 * framework-facing shape instead of ad hoc object literals.
 */
import type { RasonoModule } from './types.js';

export function defineModule<Deps>(module: RasonoModule<Deps>): RasonoModule<Deps> {
  return module;
}
