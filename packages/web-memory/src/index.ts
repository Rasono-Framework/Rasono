import type { RasonoWebRouterAdapter } from '@rasono/web-core';

export type MemoryRouter<Pages = unknown> = {
  adapter: 'memory';
  pages: Pages;
};

export function createMemoryRouterAdapter<Pages = unknown>(): RasonoWebRouterAdapter<Pages, MemoryRouter<Pages>> {
  return {
    name: 'memory',
    createRouter: ({ pages }) => ({
      adapter: 'memory',
      pages,
    }),
  };
}
