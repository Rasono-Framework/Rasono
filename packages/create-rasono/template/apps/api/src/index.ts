import { serve } from '@hono/node-server';
import { createApp } from '@rasono/app';
import { createHonoAdapter } from '@rasono/hono';
import { installSwaggerUi } from '@rasono/swagger';
import { installGeneratedActions } from './.rasono/actions.generated.js';
import { installGeneratedApi, installGeneratedDocs } from './.rasono/api.generated.js';

type Deps = {};

const deps: Deps = {};
const app = createApp({
  deps,
  transport: {
    adapter: createHonoAdapter(),
    options: {
      rateLimit: {
        enabled: true,
        limit: 300,
        windowMs: 60_000,
        trustProxy: false,
      },
    },
  },
});
await app.ready;

let closing = false;
const closeApp = async () => {
  if (closing) return;
  closing = true;
  await app.close();
};

installGeneratedApi(app);
installGeneratedActions(app);
installGeneratedDocs(app, { title: 'Rasono API', version: '0.1.0' }, { docPath: '/doc' });
installSwaggerUi(app, { uiPath: '/docs', docPath: '/doc', title: 'Rasono API Docs' });

app.get(
  '/health',
  () => new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }),
);

serve({ fetch: app.fetch, port: 3000 }, (info: { port: number }) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

process.once('SIGINT', () => {
  void closeApp().finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  void closeApp().finally(() => process.exit(0));
});
