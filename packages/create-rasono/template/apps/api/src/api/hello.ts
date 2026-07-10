import { defineRoute, defineSchema } from '@rasono/app';

const helloResponse = defineSchema(
  (input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Expected object response');
    const value = input as Record<string, unknown>;
    if (typeof value.hello !== 'string') throw new Error('Expected "hello" to be a string');
    if (typeof value.requestId !== 'string') throw new Error('Expected "requestId" to be a string');
    return { hello: value.hello, requestId: value.requestId };
  },
  {
    type: 'object',
    properties: {
      hello: { type: 'string' },
      requestId: { type: 'string' },
    },
    required: ['hello', 'requestId'],
    additionalProperties: false,
  },
);

export default defineRoute({
  method: 'get',
  summary: 'Hello',
  tags: ['system'],
  output: helloResponse,
  handler: (_c: unknown, { ctx }: { ctx: { requestId: string; tasks: { add: (task: () => Promise<void>) => void }; log: { info: (data: Record<string, unknown>, message?: string) => void } } }) => {
    ctx.tasks.add(async () => {
      ctx.log.info({ requestId: ctx.requestId }, 'background task executed');
    });
    return { hello: 'world', requestId: ctx.requestId };
  },
});
