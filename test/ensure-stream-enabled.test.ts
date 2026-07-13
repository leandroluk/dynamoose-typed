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
});
