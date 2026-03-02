import { moduleLogger } from './logger.js';

const log = moduleLogger('retry');

export interface RetryOptions {
  maxAttempts?: number;   // default 3
  baseDelayMs?: number;   // default 1000
  maxDelayMs?: number;    // default 30000
  retryOn?: (err: Error) => boolean; // custom predicate
}

/**
 * Retry an async function with exponential backoff + jitter.
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    retryOn = () => true,
  } = opts;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const shouldRetry = attempt < maxAttempts && retryOn(lastError);

      if (!shouldRetry) {
        log.error({ attempt, label, error: lastError.message }, 'All retries exhausted');
        throw lastError;
      }

      // Exponential backoff with jitter: delay = min(base * 2^attempt + jitter, max)
      const jitter = Math.random() * baseDelayMs;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1) + jitter, maxDelayMs);

      log.warn({ attempt, label, delay: Math.round(delay), error: lastError.message },
        'Retrying after failure');
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError!;
}

/** Predicate: retry on network/timeout errors, not 4xx */
export function isRetryableNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnreset') ||
    msg.includes('timeout') ||
    msg.includes('enotfound') ||
    msg.includes('socket hang up') ||
    msg.includes('429') || // rate limit — retry after backoff
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503')
  );
}
