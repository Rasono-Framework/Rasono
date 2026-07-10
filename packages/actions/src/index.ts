export type ServerActionDef<TInput = unknown, TOutput = unknown> = {
  summary?: string;
  description?: string;
  handler: (input: TInput, ctx: any) => Promise<TOutput> | TOutput;
};

export function defineServerAction<TInput = unknown, TOutput = unknown>(
  def: ServerActionDef<TInput, TOutput>,
): ServerActionDef<TInput, TOutput> {
  return def;
}

export type ServerActionClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

export function createServerActionClient(options: ServerActionClientOptions) {
  const f = options.fetch ?? fetch;

  return {
    async invoke<TOutput = unknown, TInput = unknown>(path: string, input: TInput): Promise<TOutput> {
      const res = await f(joinUrl(options.baseUrl, path), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.headers ?? {}),
        },
        body: JSON.stringify({ input }),
      });

      const payload = (await res.json()) as { ok?: boolean; data?: TOutput };
      if (!res.ok || !payload.ok) {
        throw new Error(`server action failed: ${res.status}`);
      }

      return payload.data as TOutput;
    },
  };
}
