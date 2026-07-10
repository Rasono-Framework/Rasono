/**
 * Purpose: Provide the minimal framework-level contracts for request-scoped data sessions and repositories.
 * Goal: Keep Rasono adapter-first while making transaction boundaries explicit and dependency wiring predictable.
 * Value: Gives every provider one safe orchestration path for session lifecycle, transaction cleanup, and repository injection.
 */
import { defineDep, type DepContext, type DepDefinition, type DepScope } from '@rasono/app';

export type DataAdapter<Session, Transaction = Session> = {
  name: string;
  openSession: () => Session | Promise<Session>;
  closeSession?: (session: Session) => void | Promise<void>;
  runInTransaction?: <T>(session: Session, work: (transaction: Transaction) => Promise<T>) => Promise<T>;
  beginTransaction?: (session: Session) => Transaction | Promise<Transaction>;
  commitTransaction?: (transaction: Transaction) => void | Promise<void>;
  rollbackTransaction?: (transaction: Transaction, error: unknown) => void | Promise<void>;
};

export type DataSession<Session, Transaction = Session> = {
  adapterName: string;
  raw: Session;
  withTransaction: <T>(work: (input: { session: Session; transaction: Transaction }) => T | Promise<T>) => Promise<T>;
};

export type RepositoryFactoryInput<SessionValue, Deps> = {
  session: SessionValue;
  resolve: DepContext<Deps>['resolve'];
};

export type RepositoryFactory<SessionValue, Deps, Value> = (
  input: RepositoryFactoryInput<SessionValue, Deps>,
) => Value | Promise<Value>;

function toError(value: unknown, fallbackMessage: string): Error {
  return value instanceof Error ? value : new Error(fallbackMessage, { cause: value });
}

function combineOperationErrors(
  primary: unknown,
  secondary: unknown,
  context: string,
): Error {
  const primaryError = toError(primary, `Operation failed during ${context}`);
  const secondaryError = toError(secondary, `Operation cleanup failed during ${context}`);
  return new AggregateError([primaryError, secondaryError], `${primaryError.message} (${context} cleanup also failed)`);
}

export type StoredOperationError = {
  name: string;
  message: string;
  code?: string;
};

export type IdempotencyState = 'in_progress' | 'completed' | 'failed';

export type IdempotencyRecord<Result = unknown> = {
  key: string;
  fingerprint: string;
  state: IdempotencyState;
  recoveryPoint?: string;
  response?: Result;
  error?: StoredOperationError;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

export type BeginIdempotentExecutionInput = {
  key: string;
  fingerprint: string;
  recoveryPoint?: string;
  now?: Date;
  ttlMs?: number;
};

export type BeginIdempotentExecutionResult<Result = unknown> =
  | { kind: 'started'; record: IdempotencyRecord<Result> }
  | { kind: 'replayed'; record: IdempotencyRecord<Result> }
  | { kind: 'in_progress'; record: IdempotencyRecord<Result> }
  | { kind: 'conflict'; record: IdempotencyRecord<Result> };

export type CompleteIdempotentExecutionInput<Result> = {
  key: string;
  fingerprint: string;
  response: Result;
  recoveryPoint?: string;
  now?: Date;
};

export type FailIdempotentExecutionInput = {
  key: string;
  fingerprint: string;
  error: StoredOperationError;
  recoveryPoint?: string;
  now?: Date;
};

export type IdempotencyStore<Result = unknown> = {
  begin: (input: BeginIdempotentExecutionInput) => Promise<BeginIdempotentExecutionResult<Result>>;
  complete: (input: CompleteIdempotentExecutionInput<Result>) => Promise<IdempotencyRecord<Result>>;
  fail: (input: FailIdempotentExecutionInput) => Promise<IdempotencyRecord<Result>>;
};

export type ExecuteIdempotentOperationOptions<Result> = {
  store: IdempotencyStore<Result>;
  key: string;
  fingerprint: string;
  recoveryPoint?: string;
  ttlMs?: number;
  now?: Date;
  execute: () => Promise<Result>;
};

export type IdempotentOperationExecutionResult<Result> =
  | { kind: 'executed'; record: IdempotencyRecord<Result>; result: Result }
  | { kind: 'replayed'; record: IdempotencyRecord<Result>; result: Result | undefined }
  | { kind: 'in_progress'; record: IdempotencyRecord<Result> }
  | { kind: 'conflict'; record: IdempotencyRecord<Result> };

export type OutboxMessage<Payload = unknown> = {
  id: string;
  topic: string;
  payload: Payload;
  dedupeKey?: string;
  headers?: Record<string, string>;
  createdAt?: string;
  availableAt?: string;
};

export type OutboxLeaseInput = {
  consumer: string;
  limit: number;
  visibilityTimeoutMs?: number;
  now?: Date;
};

export type OutboxAcknowledgeInput<Message extends OutboxMessage = OutboxMessage> = {
  consumer: string;
  message: Message;
  now?: Date;
};

export type OutboxReleaseInput<Message extends OutboxMessage = OutboxMessage> = {
  consumer: string;
  message: Message;
  error: StoredOperationError;
  retryAt?: string;
  now?: Date;
};

export type OutboxStore<Message extends OutboxMessage = OutboxMessage> = {
  enqueue: (message: Message) => Promise<void>;
  lease: (input: OutboxLeaseInput) => Promise<Message[]>;
  acknowledge: (input: OutboxAcknowledgeInput<Message>) => Promise<void>;
  release: (input: OutboxReleaseInput<Message>) => Promise<void>;
};

export type DrainOutboxMessagesOptions<Message extends OutboxMessage = OutboxMessage> = {
  store: OutboxStore<Message>;
  consumer: string;
  limit: number;
  visibilityTimeoutMs?: number;
  now?: Date;
  retryAt?: (error: StoredOperationError, message: Message) => string | undefined;
  stopOnError?: boolean;
  handle: (message: Message) => Promise<void>;
};

export type DrainOutboxMessagesResult<Message extends OutboxMessage = OutboxMessage> = {
  leased: number;
  processed: number;
  failed: number;
  failures: Array<{ message: Message; error: StoredOperationError }>;
};

function extractErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('code' in value)) {
    return undefined;
  }
  return typeof value.code === 'string' ? value.code : undefined;
}

export function serializeStoredOperationError(error: unknown): StoredOperationError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(extractErrorCode(error) ? { code: extractErrorCode(error) } : {}),
    };
  }

  return {
    name: 'UnknownError',
    message: typeof error === 'string' ? error : 'Unexpected error',
    ...(extractErrorCode(error) ? { code: extractErrorCode(error) } : {}),
  };
}

async function runTransaction<Session, Transaction, T>(
  adapter: DataAdapter<Session, Transaction>,
  session: Session,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  if (adapter.runInTransaction) {
    return adapter.runInTransaction(session, work);
  }

  if (adapter.beginTransaction) {
    const transaction = await adapter.beginTransaction(session);
    try {
      const result = await work(transaction);
      await adapter.commitTransaction?.(transaction);
      return result;
    } catch (error) {
      try {
        await adapter.rollbackTransaction?.(transaction, error);
      } catch (rollbackError) {
        throw combineOperationErrors(error, rollbackError, 'rollback');
      }
      throw error;
    }
  }

  return work(session as unknown as Transaction);
}

export function defineIdempotencyStore<Result>(
  store: IdempotencyStore<Result>,
): IdempotencyStore<Result> {
  return store;
}

export function defineOutboxStore<Message extends OutboxMessage>(
  store: OutboxStore<Message>,
): OutboxStore<Message> {
  return store;
}

export async function executeIdempotentOperation<Result>(
  options: ExecuteIdempotentOperationOptions<Result>,
): Promise<IdempotentOperationExecutionResult<Result>> {
  const started = await options.store.begin({
    key: options.key,
    fingerprint: options.fingerprint,
    recoveryPoint: options.recoveryPoint,
    now: options.now,
    ttlMs: options.ttlMs,
  });

  if (started.kind === 'replayed') {
    return {
      kind: 'replayed',
      record: started.record,
      result: started.record.response,
    };
  }

  if (started.kind === 'in_progress') {
    return started;
  }

  if (started.kind === 'conflict') {
    return started;
  }

  try {
    const result = await options.execute();
    const record = await options.store.complete({
      key: options.key,
      fingerprint: options.fingerprint,
      response: result,
      recoveryPoint: options.recoveryPoint,
      now: options.now,
    });
    return {
      kind: 'executed',
      record,
      result,
    };
  } catch (error) {
    try {
      await options.store.fail({
        key: options.key,
        fingerprint: options.fingerprint,
        error: serializeStoredOperationError(error),
        recoveryPoint: options.recoveryPoint,
        now: options.now,
      });
    } catch (failError) {
      throw combineOperationErrors(error, failError, 'idempotency failure persistence');
    }
    throw error;
  }
}

export async function drainOutboxMessages<Message extends OutboxMessage>(
  options: DrainOutboxMessagesOptions<Message>,
): Promise<DrainOutboxMessagesResult<Message>> {
  const messages = await options.store.lease({
    consumer: options.consumer,
    limit: options.limit,
    visibilityTimeoutMs: options.visibilityTimeoutMs,
    now: options.now,
  });

  let processed = 0;
  let failed = 0;
  const failures: Array<{ message: Message; error: StoredOperationError }> = [];

  for (const message of messages) {
    try {
      await options.handle(message);
      await options.store.acknowledge({
        consumer: options.consumer,
        message,
        now: options.now,
      });
      processed += 1;
    } catch (error) {
      const storedError = serializeStoredOperationError(error);
      failed += 1;
      failures.push({ message, error: storedError });

      try {
        await options.store.release({
          consumer: options.consumer,
          message,
          error: storedError,
          retryAt: options.retryAt?.(storedError, message),
          now: options.now,
        });
      } catch (releaseError) {
        throw combineOperationErrors(error, releaseError, 'outbox release');
      }

      if (options.stopOnError) {
        break;
      }
    }
  }

  return {
    leased: messages.length,
    processed,
    failed,
    failures,
  };
}

export function defineDataAdapter<Session, Transaction = Session>(
  adapter: DataAdapter<Session, Transaction>,
): DataAdapter<Session, Transaction> {
  return adapter;
}

export function createDataSessionDep<Session, Transaction = Session, Deps = unknown>(
  adapter: DataAdapter<Session, Transaction>,
): DepDefinition<DataSession<Session, Transaction>, Deps> {
  return defineDep<DataSession<Session, Transaction>, Deps>({
    scope: 'request',
    create: async () => {
      const raw = await adapter.openSession();
      return {
        adapterName: adapter.name,
        raw,
        withTransaction: async <T>(work: (input: { session: Session; transaction: Transaction }) => T | Promise<T>) =>
          runTransaction(adapter, raw, async (transaction) => work({ session: raw, transaction })),
      };
    },
    dispose: async (session) => {
      await adapter.closeSession?.(session.raw);
    },
  });
}

export function defineRepository<SessionValue, Deps, Value>(
  factory: RepositoryFactory<SessionValue, Deps, Value>,
): RepositoryFactory<SessionValue, Deps, Value> {
  return factory;
}

export function createRepositoryDep<
  Value,
  SessionValue,
  Deps extends Record<string, unknown>,
  SessionKey extends keyof Deps,
>(
  options: {
    sessionKey: SessionKey;
    scope?: Extract<DepScope, 'request' | 'transient'>;
    create: RepositoryFactory<SessionValue, Deps, Value>;
  },
): DepDefinition<Value, Deps> {
  return defineDep<Value, Deps>({
    scope: options.scope ?? 'request',
    create: async (ctx) => {
      const session = (await ctx.resolve(options.sessionKey)) as SessionValue;
      return options.create({
        session,
        resolve: ctx.resolve,
      });
    },
  });
}
