/**
 * Purpose: Expose a thin Drizzle provider for Rasono data sessions.
 * Goal: Preserve Drizzle's native transaction API instead of wrapping it behind a custom ORM layer.
 * Value: Lets teams adopt official Rasono data wiring without losing Drizzle features, transaction options, or future dialect capabilities.
 */
import { defineDataAdapter, type DataAdapter } from '@rasono/data';

export type DrizzleTransactionClientLike<Transaction, TransactionOptions = unknown> = {
  transaction: <T>(
    work: (transaction: Transaction) => Promise<T>,
    config?: TransactionOptions,
  ) => Promise<T>;
};

export type DrizzleClientFactory<Client> = Client | (() => Client | Promise<Client>);

export type CreateDrizzleDataAdapterOptions<
  Client extends DrizzleTransactionClientLike<Transaction, TransactionOptions>,
  Transaction,
  TransactionOptions = unknown,
> = {
  client: DrizzleClientFactory<Client>;
  name?: string;
  transactionOptions?: TransactionOptions;
  closeSession?: (client: Client) => void | Promise<void>;
};

async function resolveClient<Client>(client: DrizzleClientFactory<Client>): Promise<Client> {
  return typeof client === 'function' ? (client as () => Client | Promise<Client>)() : client;
}

export function createDrizzleDataAdapter<
  Client extends DrizzleTransactionClientLike<Transaction, TransactionOptions>,
  Transaction = Client,
  TransactionOptions = unknown,
>(
  options: CreateDrizzleDataAdapterOptions<Client, Transaction, TransactionOptions>,
): DataAdapter<Client, Transaction> {
  return defineDataAdapter<Client, Transaction>({
    name: options.name ?? 'drizzle',
    openSession: () => resolveClient(options.client),
    closeSession: options.closeSession,
    runInTransaction: async (client, work) => client.transaction((transaction) => work(transaction), options.transactionOptions),
  });
}
