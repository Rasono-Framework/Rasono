import { RouterComponent, defineRouter } from 'rasengan';
import type { RasonoWebRouterAdapter } from '@rasono/web-core';

export const rasenganRouterAdapter: RasonoWebRouterAdapter<unknown, unknown> = {
  name: 'rasengan',
  createRouter: ({ pages }) => {
    class AppRouter extends RouterComponent {}
    return defineRouter({ pages: pages as never })(AppRouter);
  },
};
