import {StreamPoller, type DynamoDBStreamsLike} from '#/streams/stream-poller';
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from 'vitest';

function makeClient(): DynamoDBStreamsLike & {
  describeStream: Mock<DynamoDBStreamsLike['describeStream']>;
  getShardIterator: Mock<DynamoDBStreamsLike['getShardIterator']>;
  getRecords: Mock<DynamoDBStreamsLike['getRecords']>;
} {
  return {
    describeStream: vi.fn<DynamoDBStreamsLike['describeStream']>(),
    getShardIterator: vi.fn<DynamoDBStreamsLike['getShardIterator']>(),
    getRecords: vi.fn<DynamoDBStreamsLike['getRecords']>(),
  };
}

const OPEN_SHARD = {ShardId: 'shard-1'};
const CLOSED_SHARD = {ShardId: 'shard-closed', SequenceNumberRange: {EndingSequenceNumber: '999'}};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StreamPoller — happy path + listener management', () => {
  it('discovers only open shards and delivers a matching INSERT event', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD, CLOSED_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventName: 'INSERT',
            dynamodb: {NewImage: {id: {S: 'u1'}}, Keys: {id: {S: 'u1'}}},
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent, onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    expect(client.getShardIterator).toHaveBeenCalledTimes(1);
    expect(client.getShardIterator).toHaveBeenCalledWith({
      StreamArn: 'arn:test',
      ShardId: 'shard-1',
      ShardIteratorType: 'LATEST',
    });
    expect(onEvent).toHaveBeenCalledWith({eventName: 'INSERT', image: {id: 'u1'}});
  });

  it('filters events by eventTypes across multiple independent listeners', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [{eventName: 'REMOVE', dynamodb: {OldImage: {id: {S: 'u1'}}}}],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onInsert = vi.fn();
    const onRemove = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent: onInsert, onError: vi.fn()});
    poller.addListener({eventTypes: ['REMOVE'], onEvent: onRemove, onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    expect(onInsert).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledWith({eventName: 'REMOVE', image: {id: 'u1'}});
  });

  it('falls back to Keys when the requested image is absent (e.g. KEYS_ONLY view)', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [{eventName: 'MODIFY', dynamodb: {Keys: {id: {S: 'u1'}}}}],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    poller.addListener({eventTypes: ['MODIFY'], onEvent, onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    expect(onEvent).toHaveBeenCalledWith({eventName: 'MODIFY', image: {id: 'u1'}});
  });

  it('does not start polling until the first listener is added, and stops when the last is removed', async () => {
    const client = makeClient();
    const poller = new StreamPoller(client, 'arn:test');
    expect(client.describeStream).not.toHaveBeenCalled();

    client.describeStream.mockResolvedValue({StreamDescription: {Shards: []}});
    const unsubscribe = poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError: vi.fn()});
    await vi.advanceTimersByTimeAsync(0);
    expect(client.describeStream).toHaveBeenCalledTimes(1);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.describeStream).toHaveBeenCalledTimes(1); // no rescan after stop
  });

  it('a second listener does not trigger a second bootstrap; removing one of two keeps polling', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: []}});
    const poller = new StreamPoller(client, 'arn:test');
    const unsubscribeA = poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError: vi.fn()});
    await vi.advanceTimersByTimeAsync(0);
    poller.addListener({eventTypes: ['MODIFY'], onEvent: vi.fn(), onError: vi.fn()});
    expect(client.describeStream).toHaveBeenCalledTimes(1);
    expect(poller.listenerCount).toBe(2);

    unsubscribeA();
    expect(poller.listenerCount).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.describeStream).toHaveBeenCalledTimes(2); // periodic rescan still running
  });

  it('routes a callback that throws to onError instead of crashing the poller', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [{eventName: 'INSERT', dynamodb: {NewImage: {id: {S: 'u1'}}}}],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onError = vi.fn();
    poller.addListener({
      eventTypes: ['INSERT'],
      onEvent: () => {
        throw new Error('callback boom');
      },
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'callback boom'}));
  });

  it('routes an async callback rejection to onError instead of crashing the poller', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [{eventName: 'INSERT', dynamodb: {NewImage: {id: {S: 'u1'}}}}],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onError = vi.fn();
    poller.addListener({
      eventTypes: ['INSERT'],
      onEvent: async () => {
        throw new Error('async callback boom');
      },
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'async callback boom'}));
  });
});

describe('StreamPoller — resilience', () => {
  it('discovers a child shard once its parent closes (NextShardIterator undefined)', async () => {
    const client = makeClient();
    client.describeStream
      .mockResolvedValueOnce({StreamDescription: {Shards: [OPEN_SHARD]}})
      .mockResolvedValueOnce({
        StreamDescription: {
          Shards: [
            {...OPEN_SHARD, SequenceNumberRange: {EndingSequenceNumber: '1'}},
            {ShardId: 'shard-child', ParentShardId: 'shard-1'},
          ],
        },
      })
      .mockResolvedValue({
        StreamDescription: {
          Shards: [
            {...OPEN_SHARD, SequenceNumberRange: {EndingSequenceNumber: '1'}},
            {ShardId: 'shard-child', ParentShardId: 'shard-1'},
          ],
        },
      });
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords.mockResolvedValueOnce({Records: [], NextShardIterator: undefined}).mockResolvedValue({
      Records: [],
      NextShardIterator: 'iter-2',
    });

    const poller = new StreamPoller(client, 'arn:test');
    poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.getShardIterator).toHaveBeenCalledWith(
      expect.objectContaining({ShardId: 'shard-child', ShardIteratorType: 'LATEST'})
    );
  });

  it('re-acquires a LATEST iterator on ExpiredIteratorException and keeps polling', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator
      .mockResolvedValueOnce({ShardIterator: 'iter-1'})
      .mockResolvedValueOnce({ShardIterator: 'iter-2'});
    const expiredError = Object.assign(new Error('expired'), {name: 'ExpiredIteratorException'});
    client.getRecords.mockRejectedValueOnce(expiredError).mockResolvedValue({Records: [], NextShardIterator: 'iter-3'});

    const poller = new StreamPoller(client, 'arn:test');
    const onError = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.getShardIterator).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a failed re-acquire after ExpiredIteratorException and stops that shard', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    const expiredError = Object.assign(new Error('expired'), {name: 'ExpiredIteratorException'});
    client.getShardIterator
      .mockResolvedValueOnce({ShardIterator: 'iter-1'})
      .mockRejectedValueOnce(new Error('reacquire failed'));
    client.getRecords.mockRejectedValue(expiredError);

    const poller = new StreamPoller(client, 'arn:test');
    const onError = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'reacquire failed'}));
  });

  it('reports a transient getRecords error via onError and retries after backoff', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockRejectedValueOnce(new Error('throttled'))
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onError = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError});

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'throttled'}));

    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getRecords).toHaveBeenCalledTimes(2);
  });

  it('reports a describeStream failure via onError without throwing', async () => {
    const client = makeClient();
    client.describeStream.mockRejectedValueOnce(new Error('describe failed')).mockResolvedValue({
      StreamDescription: {Shards: []},
    });

    const poller = new StreamPoller(client, 'arn:test');
    const onError = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError});

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'describe failed'}));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.describeStream).toHaveBeenCalledTimes(2);
  });

  it('reports a getShardIterator failure via onError and stops that shard', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockRejectedValue(new Error('iterator failed'));

    const poller = new StreamPoller(client, 'arn:test');
    const onError = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError});

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'iterator failed'}));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.getShardIterator).toHaveBeenCalledTimes(2); // rescan retried the same still-open shard
  });

  it('stops mid-shard-read when the last listener is removed', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords.mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const unsubscribe = poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeStop = client.getRecords.mock.calls.length;
    unsubscribe();
    await vi.advanceTimersByTimeAsync(5000);

    expect(client.getRecords.mock.calls.length).toBe(callsBeforeStop);
  });

  it('treats a describeStream response with no Shards field as having no shards', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {}});

    const poller = new StreamPoller(client, 'arn:test');
    poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    expect(client.getShardIterator).not.toHaveBeenCalled();
  });

  it('treats a getRecords response with no Records field as an empty batch', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords.mockResolvedValue({NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent, onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    expect(onEvent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getRecords).toHaveBeenCalledTimes(2);
  });

  it('unmarshalls an empty image when both the requested image and Keys are absent', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({Records: [{eventName: 'INSERT', dynamodb: {}}], NextShardIterator: 'iter-2'})
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent, onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    expect(onEvent).toHaveBeenCalledWith({eventName: 'INSERT', image: {}});
  });
});
