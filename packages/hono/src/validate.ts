import { appErrors } from '@rasono/core';
import type { Schema } from '@rasono/core';

type JsonCapableContext = {
  req: {
    json: () => Promise<unknown>;
  };
};

export async function parseJson<T>(c: JsonCapableContext, schema: Schema<T>): Promise<T> {
  try {
    const payload = await c.req.json();
    return schema.parse(payload);
  } catch (e) {
    throw appErrors.validation(e);
  }
}

