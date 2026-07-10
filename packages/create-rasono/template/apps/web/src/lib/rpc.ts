import { createGeneratedRpcClient } from '@/.rasono/rpc.generated';

const apiBaseUrl = 'http://localhost:3000';

export const rpc = createGeneratedRpcClient({
  baseUrl: apiBaseUrl,
});
