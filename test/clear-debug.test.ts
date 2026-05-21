import {beforeEach, describe, expect, it, vi} from 'vitest';

describe('vi.clearAllMocks behavior', () => {
  const obj: Record<string, any> = {};
  obj.fn = vi.fn().mockReturnValue(obj);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fn returns obj after clear', () => {
    const result = obj.fn();
    console.log('result === obj:', result === obj, 'type:', typeof obj.fn);
    expect(result).toBe(obj);
  });

  it('fn still returns obj on second test', () => {
    const result = obj.fn();
    expect(result).toBe(obj);
  });
});
