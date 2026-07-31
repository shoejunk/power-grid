/**
 * Tiny structured logger.
 *
 * The server logs a lot of things the operator genuinely needs to see —
 * notably every automatic action taken on behalf of a disconnected player
 * (requirement 8: "clearly logged"). Keeping this dependency-free means the
 * test suite can swap in a silent logger without any plumbing.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

function format(level: LogLevel, scope: string, msg: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const tail = data && Object.keys(data).length > 0 ? ` ${safeJson(data)}` : '';
  return `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${tail}`;
}

/** JSON.stringify that never throws on cycles or BigInt. */
function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v as object)) return '[circular]';
        seen.add(v as object);
      }
      return v;
    }) ?? String(value);
  } catch {
    return String(value);
  }
}

export function createLogger(minLevel: LogLevel = 'info', scope = 'pg'): Logger {
  const min = LEVEL_RANK[minLevel];
  const emit = (level: LogLevel, msg: string, data?: Record<string, unknown>): void => {
    if (LEVEL_RANK[level] < min) return;
    const line = format(level, scope, msg, data);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
    child: (s) => createLogger(minLevel, `${scope}:${s}`),
  };
}

/** A logger that swallows everything — used by the test suite. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
