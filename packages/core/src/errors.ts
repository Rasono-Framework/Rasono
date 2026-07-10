export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNEXPECTED';

export type AppErrorShape = {
  code: AppErrorCode;
  message: string;
  requestId?: string;
};

export type HttpErrorCode = string;

export type HttpErrorShape = {
  code: HttpErrorCode;
  detail: string;
  requestId?: string;
};

type AppErrorInit = {
  code: AppErrorCode;
  status: number;
  publicMessage: string;
  cause?: unknown;
};

type HttpErrorInit = {
  status: number;
  detail: string;
  code?: HttpErrorCode;
  headers?: Record<string, string>;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly publicMessage: string;

  constructor(init: AppErrorInit) {
    super(init.publicMessage, { cause: init.cause });
    this.name = 'AppError';
    this.code = init.code;
    this.status = init.status;
    this.publicMessage = init.publicMessage;
  }

  toPublicShape(requestId?: string): AppErrorShape {
    return {
      code: this.code,
      message: this.publicMessage,
      ...(requestId ? { requestId } : {}),
    };
  }
}

export const appErrors = {
  validation: (cause?: unknown) =>
    new AppError({
      code: 'VALIDATION_ERROR',
      status: 400,
      publicMessage: 'Invalid request',
      cause,
    }),
  authRequired: () =>
    new AppError({
      code: 'AUTH_REQUIRED',
      status: 401,
      publicMessage: 'Authentication required',
    }),
  forbidden: () =>
    new AppError({
      code: 'FORBIDDEN',
      status: 403,
      publicMessage: 'Forbidden',
    }),
  notFound: () =>
    new AppError({
      code: 'NOT_FOUND',
      status: 404,
      publicMessage: 'Not found',
    }),
  conflict: (publicMessage = 'Conflict') =>
    new AppError({
      code: 'CONFLICT',
      status: 409,
      publicMessage,
    }),
  rateLimited: () =>
    new AppError({
      code: 'RATE_LIMITED',
      status: 429,
      publicMessage: 'Too many requests',
    }),
  unexpected: (cause?: unknown) =>
    new AppError({
      code: 'UNEXPECTED',
      status: 500,
      publicMessage: 'Internal server error',
      cause,
    }),
} as const;

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: HttpErrorCode;
  readonly detail: string;
  readonly headers?: Record<string, string>;

  constructor(init: HttpErrorInit) {
    super(init.detail, { cause: init.cause });
    this.name = 'HttpError';
    this.status = init.status;
    this.code = init.code ?? 'HTTP_ERROR';
    this.detail = init.detail;
    this.headers = init.headers;
  }

  toPublicShape(requestId?: string): HttpErrorShape {
    return {
      code: this.code,
      detail: this.detail,
      ...(requestId ? { requestId } : {}),
    };
  }
}

export function httpError(status: number, detail: string, options?: { code?: HttpErrorCode; headers?: Record<string, string>; cause?: unknown }): HttpError {
  return new HttpError({
    status,
    detail,
    code: options?.code,
    headers: options?.headers,
    cause: options?.cause,
  });
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
