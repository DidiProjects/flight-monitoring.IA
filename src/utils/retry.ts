import { logger } from './logger.ts';

interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  label?: string;
}

/**
 * Retries an async function with exponential back-off + jitter.
 * Follows the pattern recommended by AWS and Google SRE guides.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 4, initialDelay = 2_000, maxDelay = 30_000, label = 'operation' } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) break;

      const base = initialDelay * 2 ** (attempt - 1);
      const jitter = base * 0.25 * Math.random();
      const delay = Math.min(base + jitter, maxDelay);

      logger.warn(
        { attempt, maxAttempts, delayMs: Math.round(delay), label },
        `Attempt ${attempt} failed — retrying in ${(delay / 1000).toFixed(1)}s`,
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
