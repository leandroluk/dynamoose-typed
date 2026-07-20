import {ensureStreamEnabled} from '#/streams/ensure-stream-enabled';
import {describe, expect, it, vi} from 'vitest';

describe('ensureStreamEnabled', () => {
  it('returns the existing ARN without calling updateTable when already enabled with the same view type', async () => {
    const describeTable = vi.fn().mockResolvedValue({
      Table: {
        LatestStreamArn: 'arn:already-enabled',
        StreamSpecification: {StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES'},
      },
    });
    const updateTable = vi.fn();

    const arn = await ensureStreamEnabled({describeTable, updateTable}, 'users', 'NEW_AND_OLD_IMAGES');

    expect(arn).toBe('arn:already-enabled');
    expect(updateTable).not.toHaveBeenCalled();
  });

  it('calls updateTable when the stream is enabled with a different view type', async () => {
    const describeTable = vi.fn().mockResolvedValue({
      Table: {
        LatestStreamArn: 'arn:old',
        StreamSpecification: {StreamEnabled: true, StreamViewType: 'NEW_IMAGE'},
      },
    });
    const updateTable = vi.fn().mockResolvedValue({TableDescription: {LatestStreamArn: 'arn:new'}});

    const arn = await ensureStreamEnabled({describeTable, updateTable}, 'users', 'NEW_AND_OLD_IMAGES');

    expect(arn).toBe('arn:new');
    expect(updateTable).toHaveBeenCalledWith({
      TableName: 'users',
      StreamSpecification: {StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES'},
    });
  });

  it('calls updateTable when the stream is not enabled at all', async () => {
    const describeTable = vi.fn().mockResolvedValue({Table: {StreamSpecification: {StreamEnabled: false}}});
    const updateTable = vi.fn().mockResolvedValue({TableDescription: {LatestStreamArn: 'arn:freshly-enabled'}});

    const arn = await ensureStreamEnabled({describeTable, updateTable}, 'orders', 'KEYS_ONLY');

    expect(arn).toBe('arn:freshly-enabled');
    expect(updateTable).toHaveBeenCalledWith({
      TableName: 'orders',
      StreamSpecification: {StreamEnabled: true, StreamViewType: 'KEYS_ONLY'},
    });
  });

  it('retries describeTable on ResourceNotFoundException with backoff', async () => {
    const describeTable = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('not yet'), {name: 'ResourceNotFoundException'}))
      .mockRejectedValueOnce(Object.assign(new Error('still not'), {name: 'ResourceNotFoundException'}))
      .mockResolvedValueOnce({
        Table: {
          LatestStreamArn: 'arn:retried',
          StreamSpecification: {StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES'},
        },
      });
    const updateTable = vi.fn();

    const arn = await ensureStreamEnabled({describeTable, updateTable}, 'slow-table', 'NEW_AND_OLD_IMAGES');

    expect(arn).toBe('arn:retried');
    expect(describeTable).toHaveBeenCalledTimes(3);
    expect(updateTable).not.toHaveBeenCalled();
  });

  it('still throws on non-retryable errors', async () => {
    const describeTable = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('access denied'), {name: 'AccessDeniedException'}));
    const updateTable = vi.fn();

    await expect(ensureStreamEnabled({describeTable, updateTable}, 'blocked', 'KEYS_ONLY')).rejects.toThrow(
      'access denied'
    );
    expect(describeTable).toHaveBeenCalledTimes(1);
  });
});
