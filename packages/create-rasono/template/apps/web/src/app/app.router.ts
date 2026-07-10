import { createWebRouter } from '@rasono/web-core';
import { generatedPages } from '@/.rasono/pages.generated';
import { rasenganRouterAdapter } from './router.adapter';

export default createWebRouter(rasenganRouterAdapter, { pages: generatedPages });
