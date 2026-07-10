import { defineServerAction } from '@rasono/actions';

export default defineServerAction({
  summary: 'Ping action',
  description: 'Simple server action example.',
  handler: async (input: { name?: string } | undefined) => {
    return {
      ok: true,
      message: `pong${input?.name ? ` ${input.name}` : ''}`,
    };
  },
});
