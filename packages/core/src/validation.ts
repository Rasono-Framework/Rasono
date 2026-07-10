export type OpenApiSchema = Record<string, unknown>;

export type Schema<T> = {
  parse: (input: unknown) => T;
  openapi?: OpenApiSchema;
};

export function defineSchema<T>(parse: (input: unknown) => T, openapi?: OpenApiSchema): Schema<T> {
  return {
    parse,
    ...(openapi ? { openapi } : {}),
  };
}

export function isSchema(value: unknown): value is Schema<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parse' in value &&
    typeof (value as { parse?: unknown }).parse === 'function'
  );
}
