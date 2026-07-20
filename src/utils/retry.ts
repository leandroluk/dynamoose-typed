export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? 15;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  const maxDelayMs = options?.maxDelayMs ?? 15000;
  const shouldRetry = options?.shouldRetry ?? (() => true);

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !shouldRetry(err, attempt)) {
        throw err;
      }
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jitter = Math.random() * delay;
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }
  }
}
