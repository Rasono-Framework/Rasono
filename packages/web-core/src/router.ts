export type RasonoWebRouterAdapter<Pages = unknown, Router = unknown> = {
  name: string;
  createRouter: (options: { pages: Pages }) => Router;
};

export function createWebRouter<Pages, Router>(
  adapter: RasonoWebRouterAdapter<Pages, Router>,
  options: { pages: Pages },
): Router {
  return adapter.createRouter(options);
}
