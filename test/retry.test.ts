import {retryWithBackoff} from '#/utils/retry';
import {describe, expect, it, vi} from 'vitest';

describe('retryWithBackoff', () => {
  it('resolves immediately when fn succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and resolves when fn eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('recovered');

    const result = await retryWithBackoff(fn, {
      maxRetries: 5,
      baseDelayMs: 5,
      maxDelayMs: 20,
    });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting maxRetries', async () => {
    const error = new Error('persistent');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 3,
        baseDelayMs: 5,
        maxDelayMs: 20,
      })
    ).rejects.toThrow('persistent');
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('does not retry when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));
    const onError = vi.fn();

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 5,
        shouldRetry: (err: unknown) => {
          onError((err as Error).message);
          return false;
        },
      })
    ).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('non-retryable');
  });

  it('respects maxDelayMs cap', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const start = Date.now();

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 3,
        baseDelayMs: 10000,
        maxDelayMs: 50,
      })
    ).rejects.toThrow('fail');

    // With maxDelayMs=50 and 3 retries, should take ~150ms-300ms total
    // (each retry waits delay ~ 50-100ms with jitter)
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('works with zero maxRetries (no retries)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(
      retryWithBackoff(fn, {
        maxRetries: 0,
      })
    ).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses default options when none provided', async () => {
    const fn = vi.fn().mockResolvedValue('defaults');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('defaults');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
