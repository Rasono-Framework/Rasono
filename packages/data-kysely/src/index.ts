/**
 * Purpose: Expose a thin Kysely provider for Rasono data sessions across PostgreSQL, MySQL, SQLite, MSSQL, and custom dialects.
 * Goal: Preserve Kysely's native transaction and dialect model instead of wrapping it behind a framework-owned query layer.
 * Value: Gives teams an official multi-database provider with explicit transaction configuration, predictable cleanup, and zero ORM lock-in.
 */
import { defineDataAdapter, type DataAdapter } from '@rasono/data';

export type KyselyTransactionBuilderLike<Transaction, IsolationLevel = string> = {
  execute: <T>(work: (transaction: Transaction) => Promise<T>) => Promise<T>;
  setIsolationLevel?: (
    isolationLevel: IsolationLevel,
  ) => KyselyTransactionBuilderLike<Transaction, IsolationLevel>;
};

export type KyselyTransactionClientLike<Transaction, IsolationLevel = string> = {
  transaction: () => KyselyTransactionBuilderLike<Transaction, IsolationLevel>;
  destroy?: () => void | Promise<void>;
};

export type KyselyClientFactory<Client> = Client | (() => Client | Promise<Client>);

export type CreateKyselyDataAdapterOptions<
  Client extends KyselyTransactionClientLike<Transaction, IsolationLevel>,
  Transaction = Client,
  IsolationLevel = string,
> = {
  client: KyselyClientFactory<Client>;
  name?: string;
  isolationLevel?: IsolationLevel;
  configureTransaction?: (
    builder: KyselyTransactionBuilderLike<Transaction, IsolationLevel>,
  ) => KyselyTransactionBuilderLike<Transaction, IsolationLevel>;
  closeSession?: (client: Client) => void | Promise<void>;
};

async function resolveClient<Client>(client: KyselyClientFactory<Client>): Promise<Client> {
  return typeof client === 'function' ? (client as () => Client | Promise<Client>)() : client;
}

function configureTransactionBuilder<Client extends KyselyTransactionClientLike<Transaction, IsolationLevel>, Transaction, IsolationLevel>(
  client: Client,
  options: CreateKyselyDataAdapterOptions<Client, Transaction, IsolationLevel>,
): KyselyTransactionBuilderLike<Transaction, IsolationLevel> {
  let builder = client.transaction();

  if (options.isolationLevel !== undefined) {
    if (!builder.setIsolationLevel) {
      throw new Error('The provided Kysely transaction builder does not support setIsolationLevel().');
    }
    builder = builder.setIsolationLevel(options.isolationLevel);
  }

  return options.configureTransaction ? options.configureTransaction(builder) : builder;
}

export function createKyselyDataAdapter<
  Client extends KyselyTransactionClientLike<Transaction, IsolationLevel>,
  Transaction = Client,
  IsolationLevel = string,
>(
  options: CreateKyselyDataAdapterOptions<Client, Transaction, IsolationLevel>,
): DataAdapter<Client, Transaction> {
  return defineDataAdapter<Client, Transaction>({
    name: options.name ?? 'kysely',
    openSession: () => resolveClient(options.client),
    closeSession: async (client) => {
      if (options.closeSession) {
        await options.closeSession(client);
        return;
      }

      await client.destroy?.();
    },
    runInTransaction: async (client, work) => {
      const builder = configureTransactionBuilder(client, options);
      return builder.execute((transaction) => work(transaction));
    },
  });
}
