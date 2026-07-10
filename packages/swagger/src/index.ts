type InstallSwaggerUiOptions = {
  uiPath?: string;
  docPath?: string;
  title?: string;
};

import { swaggerUI } from '@hono/swagger-ui';

export function installSwaggerUi(app: any, options?: InstallSwaggerUiOptions): void {
  const uiPath = options?.uiPath ?? '/docs';
  const docPath = options?.docPath ?? '/doc';
  void options?.title;
  app.get(uiPath, swaggerUI({ url: docPath }) as any);
}
