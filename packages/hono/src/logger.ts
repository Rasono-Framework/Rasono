import type { RasonoLogger } from './types.js';

type Level = 'info' | 'warn' | 'error';

function nowIso(): string {
  return new Date().toISOString();
}

function safeString(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function color(level: Level, text: string, enabled: boolean): string {
  if (!enabled) return text;
  const reset = '\u001b[0m';
  const codes: Record<Level, string> = {
    info: '\u001b[36m',
    warn: '\u001b[33m',
    error: '\u001b[31m',
  };
  return `${codes[level]}${text}${reset}`;
}

export function createConsoleLogger(options?: { pretty?: boolean; colors?: boolean }): RasonoLogger {
  const pretty = options?.pretty ?? true;
  const colors = options?.colors ?? true;

  function write(level: Level, data: Record<string, unknown>, message?: string): void {
    const msg = message ?? '';

    if (!pretty) {
      const payload = { level, ts: nowIso(), msg, ...data };
      if (level === 'error') console.error(payload);
      else if (level === 'warn') console.warn(payload);
      else console.info(payload);
      return;
    }

    const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;
    const method = typeof data.method === 'string' ? data.method : undefined;
    const path = typeof data.path === 'string' ? data.path : undefined;
    const status = typeof data.status === 'number' ? data.status : undefined;
    const durationMs = typeof data.durationMs === 'number' ? data.durationMs : undefined;

    const left = [
      color(level, level.toUpperCase(), colors),
      nowIso(),
      requestId ? `rid=${requestId}` : undefined,
      method && path ? `${method} ${path}` : undefined,
      status ? `status=${status}` : undefined,
      durationMs !== undefined ? `t=${durationMs}ms` : undefined,
      msg.length > 0 ? msg : undefined,
    ]
      .filter(Boolean)
      .join(' ');

    const extra: Record<string, unknown> = { ...data };
    delete extra.requestId;
    delete extra.method;
    delete extra.path;
    delete extra.status;
    delete extra.durationMs;

    const hasExtra = Object.keys(extra).length > 0;
    const right = hasExtra ? ` ${safeString(extra)}` : '';

    const line = `${left}${right}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.info(line);
  }

  return {
    info: (data, message) => write('info', data, message),
    warn: (data, message) => write('warn', data, message),
    error: (data, message) => write('error', data, message),
  };
}

