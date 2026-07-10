import { createServerActionClient } from '@rasono/actions';

const apiBaseUrl = 'http://localhost:3000';

export const actions = createServerActionClient({
  baseUrl: apiBaseUrl,
});
