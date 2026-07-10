/**
 * This file defines the shared runtime contracts used by HTTP adapters, request
 * context resolution, principals, and background task execution.
 */
export type RasonoLogger = {
  info: (data: Record<string, unknown>, message?: string) => void;
  warn: (data: Record<string, unknown>, message?: string) => void;
  error: (data: Record<string, unknown>, message?: string) => void;
};

export type BackgroundTask = () => void | Promise<void>;

export type BackgroundTasks = {
  add: (task: BackgroundTask) => void;
  runAll: (options: { requestId: string; log: RasonoLogger }) => Promise<void>;
  size: () => number;
};

export type Principal = {
  sub: string;
  roles?: string[];
  tenantId?: string;
};

export type ResolvedRequestContext<Deps> = {
  deps: Deps;
  principal?: Principal;
  dispose?: () => void | Promise<void>;
};

export type RasonoRequestContext<Deps> = {
  deps: Deps;
  requestId: string;
  log: RasonoLogger;
  principal?: Principal;
  tasks: BackgroundTasks;
};

export type RequestContextResolverInput = {
  requestId: string;
  log: RasonoLogger;
  request: Request;
};

export type RequestContextResolver<Deps> = (
  input: RequestContextResolverInput,
) => ResolvedRequestContext<Deps> | Promise<ResolvedRequestContext<Deps>>;

export type HttpAppMethod = (...args: any[]) => any;

export type RasonoHttpApp<_Deps> = {
  fetch: (request: Request, env?: any, executionCtx?: any) => Response | Promise<Response>;
  get: HttpAppMethod;
  post: HttpAppMethod;
  put: HttpAppMethod;
  patch: HttpAppMethod;
  delete: HttpAppMethod;
  use: HttpAppMethod;
  route: HttpAppMethod;
};

export type HttpCommonOptions<Deps> = {
  deps?: Deps;
  logger?: RasonoLogger;
  requestIdHeaderName?: string;
  exposeUnexpectedErrorMessage?: boolean;
  accessLog?: boolean;
  resolveRequestContext?: RequestContextResolver<Deps>;
};

export type RasonoHttpAdapter<Deps, Options = unknown> = {
  name: string;
  create: (options: HttpCommonOptions<Deps> & { adapterOptions?: Options }) => RasonoHttpApp<Deps>;
};
