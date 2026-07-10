import { defineErrors, defineRoute, httpError } from '@rasono/app';

export default defineRoute({
  method: 'get',
  summary: 'HTTP error example',
  tags: ['system'],
  errors: defineErrors([
    {
      status: 400,
      code: 'BAD_REQUEST',
      description: 'Bad request example',
      detail: 'Bad request example',
    },
  ]),
  handler: () => {
    throw httpError(400, 'Bad request example', { code: 'BAD_REQUEST' });
  },
});
