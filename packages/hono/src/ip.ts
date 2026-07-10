function firstForwardedFor(headerValue: string): string | undefined {
  const first = headerValue.split(',')[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

export function getClientIp(headers: { get: (name: string) => string | undefined }, options?: { trustProxy?: boolean }): string | undefined {
  const cf = headers.get('cf-connecting-ip');
  if (cf && cf.trim().length > 0) return cf.trim();

  const realIp = headers.get('x-real-ip');
  if (realIp && realIp.trim().length > 0) return realIp.trim();

  if (options?.trustProxy) {
    const xff = headers.get('x-forwarded-for');
    if (xff) return firstForwardedFor(xff);
  }

  return undefined;
}

