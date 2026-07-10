/**
 * Purpose: Expose the optional Rasono Engine provider while keeping the native Turso/libSQL transaction model visible.
 * Goal: Offer a product-facing provider for Rasono users without making the framework depend on one ORM, one SQL dialect, or one database vendor.
 * Value: Gives production apps a safer Engine path for Turso with explicit sync, cleanup, and failure handling, while preserving framework neutrality at the core.
 */
import { defineDataAdapter, type DataAdapter } from '@rasono/data';

export type EngineTransactionMode = 'write' | 'read' | 'deferred';
export type LibsqlTransactionMode = EngineTransactionMode;

export type EngineTransactionLike = {
  closed?: boolean;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  close: () => void | Promise<void>;
};
export type LibsqlTransactionLike = EngineTransactionLike;

export type EngineTransactionalClientLike<Transaction extends EngineTransactionLike = EngineTransactionLike> = {
  transaction: (mode?: EngineTransactionMode) => Transaction | Promise<Transaction>;
  sync?: () => Promise<void>;
  close?: () => void | Promise<void>;
};
export type LibsqlTransactionalClientLike<Transaction extends LibsqlTransactionLike = LibsqlTransactionLike> =
  EngineTransactionalClientLike<Transaction>;

export type EngineClientFactory<Client> = Client | (() => Client | Promise<Client>);
export type LibsqlClientFactory<Client> = EngineClientFactory<Client>;

export type CreateEngineDataAdapterOptions<
  Client extends EngineTransactionalClientLike<Transaction>,
  Transaction extends EngineTransactionLike = Awaited<ReturnType<Client['transaction']>>,
> = {
  client: EngineClientFactory<Client>;
  name?: string;
  transactionMode?: EngineTransactionMode;
  syncOnOpen?: boolean;
  syncOnClose?: boolean;
  closeSession?: (client: Client) => void | Promise<void>;
};
export type CreateLibsqlDataAdapterOptions<
  Client extends LibsqlTransactionalClientLike<Transaction>,
  Transaction extends LibsqlTransactionLike = Awaited<ReturnType<Client['transaction']>>,
> = CreateEngineDataAdapterOptions<Client, Transaction>;

export type CreateTursoDataAdapterOptions<
  Client extends LibsqlTransactionalClientLike<Transaction>,
  Transaction extends LibsqlTransactionLike = Awaited<ReturnType<Client['transaction']>>,
> = CreateEngineDataAdapterOptions<Client, Transaction>;

export type CreateEngineClientFactoryOptions = {
  url: string;
  authToken?: string;
  syncUrl?: string;
  syncInterval?: number;
  encryptionKey?: string;
  offline?: boolean;
  intMode?: 'number' | 'bigint' | 'string';
  concurrency?: number;
};
export type CreateTursoLibsqlClientFactoryOptions = CreateEngineClientFactoryOptions;

export type EngineClientInputFactory<CreateClientInput, Client> = (
  options: CreateClientInput,
) => Client | Promise<Client>;
export type TursoClientFactory<CreateClientInput, Client> = EngineClientInputFactory<CreateClientInput, Client>;

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

async function resolveClient<Client>(client: EngineClientFactory<Client>): Promise<Client> {
  return typeof client === 'function' ? (client as () => Client | Promise<Client>)() : client;
}

function toError(value: unknown, fallbackMessage: string): Error {
  return value instanceof Error ? value : new Error(fallbackMessage, { cause: value });
}

function combineTransactionErrors(
  primary: unknown,
  secondary: unknown,
  context: string,
): Error {
  const primaryError = toError(primary, `Turso transaction failed during ${context}`);
  const secondaryError = toError(secondary, `Turso transaction cleanup failed during ${context}`);
  return new AggregateError([primaryError, secondaryError], `${primaryError.message} (${context} cleanup also failed)`);
}

async function closeTransaction(transaction: EngineTransactionLike): Promise<void> {
  await transaction.close();
}

export function createEngineDataAdapter<
  Client extends EngineTransactionalClientLike<Transaction>,
  Transaction extends EngineTransactionLike = Awaited<ReturnType<Client['transaction']>>,
>(
  options: CreateEngineDataAdapterOptions<Client, Transaction>,
): DataAdapter<Client, Transaction> {
  return defineDataAdapter<Client, Transaction>({
    name: options.name ?? 'engine',
    openSession: async () => {
      const client = await resolveClient(options.client);
      if (options.syncOnOpen && client.sync) {
        await client.sync();
      }
      return client;
    },
    closeSession: async (client) => {
      if (options.syncOnClose && client.sync) {
        await client.sync();
      }
      if (options.closeSession) {
        await options.closeSession(client);
        return;
      }
      await client.close?.();
    },
    runInTransaction: async (client, work) => {
      const transactionCandidate = client.transaction(options.transactionMode ?? 'write');
      const transaction = isPromiseLike(transactionCandidate) ? await transactionCandidate : transactionCandidate;
      let transactionError: unknown;

      try {
        const result = await work(transaction);
        await transaction.commit();
        return result;
      } catch (error) {
        transactionError = error;
        if (!transaction.closed) {
          try {
            await transaction.rollback();
          } catch (rollbackError) {
            transactionError = combineTransactionErrors(transactionError, rollbackError, 'rollback');
          }
        }
        throw transactionError;
      } finally {
        try {
          await closeTransaction(transaction);
        } catch (closeError) {
          if (transactionError !== undefined) {
            throw combineTransactionErrors(transactionError, closeError, 'close');
          }
          throw closeError;
        }
      }
    },
  });
}

export const createTursoDataAdapter = createEngineDataAdapter;
export const createLibsqlDataAdapter = createTursoDataAdapter;
export type { CreateLibsqlDataAdapterOptions as CreateLegacyLibsqlDataAdapterOptions };

export function createEngineClientFactory<CreateClientInput, Client>(
  createClient: EngineClientInputFactory<CreateClientInput, Client>,
  options: CreateEngineClientFactoryOptions,
): () => Client | Promise<Client> {
  return () =>
    createClient({
      url: options.url,
      ...(options.authToken ? { authToken: options.authToken } : {}),
      ...(options.syncUrl ? { syncUrl: options.syncUrl } : {}),
      ...(options.syncInterval !== undefined ? { syncInterval: options.syncInterval } : {}),
      ...(options.encryptionKey ? { encryptionKey: options.encryptionKey } : {}),
      ...(options.offline !== undefined ? { offline: options.offline } : {}),
      ...(options.intMode ? { intMode: options.intMode } : {}),
      ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    } as CreateClientInput);
}

export const createTursoLibsqlClientFactory = createEngineClientFactory;
