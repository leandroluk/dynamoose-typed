import {StreamPoller, type DynamoDBStreamsLike, type StreamRecordLike} from '#/streams/stream-poller';
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from 'vitest';
import type * as utilDynamoDb from '@aws-sdk/util-dynamodb';

vi.mock('@aws-sdk/util-dynamodb', async importOriginal => {
  const original = await importOriginal<typeof utilDynamoDb>();
  return {
    ...original,
    unmarshall: (val: any) => {
      if (val && val.__test_custom_image) {
        return val.__test_custom_image;
      }
      return original.unmarshall(val);
    },
  };
});

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
            eventID: 'evt-1',
            eventName: 'INSERT',
            dynamodb: {
              NewImage: {id: {S: 'u1'}},
              Keys: {id: {S: 'u1'}},
              ApproximateCreationDateTime: new Date('2026-01-01T00:00:00Z'),
              SequenceNumber: 'seq-1',
            },
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
    expect(onEvent).toHaveBeenCalledWith({
      eventId: 'evt-1',
      eventName: 'INSERT',
      image: {id: 'u1'},
      approximateCreationDateTime: new Date('2026-01-01T00:00:00Z'),
      sequenceNumber: 'seq-1',
    });
  });

  it('filters events by eventTypes across multiple independent listeners', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [{eventID: 'evt-1', eventName: 'REMOVE', dynamodb: {OldImage: {id: {S: 'u1'}}}}],
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
    expect(onRemove).toHaveBeenCalledWith({
      eventId: 'evt-1',
      eventName: 'REMOVE',
      image: {id: 'u1'},
      oldImage: {id: 'u1'},
    });
  });

  it('falls back to Keys when the requested image is absent (e.g. KEYS_ONLY view)', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [{eventID: 'evt-1', eventName: 'MODIFY', dynamodb: {Keys: {id: {S: 'u1'}}}}],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    poller.addListener({eventTypes: ['MODIFY'], onEvent, onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({eventId: 'evt-1', eventName: 'MODIFY', image: {id: 'u1'}})
    );
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

    // Parent shard was discovered on the very first rescan — still LATEST (no historical
    // backfill on first subscribe, v1 design).
    expect(client.getShardIterator).toHaveBeenCalledWith(
      expect.objectContaining({ShardId: 'shard-1', ShardIteratorType: 'LATEST'})
    );
    // Child shard was discovered on a LATER rescan (triggered after the parent closed) —
    // it must use TRIM_HORIZON so records written between the split and iterator
    // acquisition aren't silently lost.
    expect(client.getShardIterator).toHaveBeenCalledWith(
      expect.objectContaining({ShardId: 'shard-child', ShardIteratorType: 'TRIM_HORIZON'})
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

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({eventId: '', eventName: 'INSERT', image: {}}));
  });

  it('populates oldImage for MODIFY events with both NewImage and OldImage', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'MODIFY',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              OldImage: {id: {S: 'u1'}, status: {S: 'open'}},
              NewImage: {id: {S: 'u1'}, status: {S: 'overdue'}},
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    poller.addListener({eventTypes: ['MODIFY'], onEvent, onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    expect(onEvent).toHaveBeenCalledWith({
      eventId: 'evt-1',
      eventName: 'MODIFY',
      image: {id: 'u1', status: 'overdue'},
      oldImage: {id: 'u1', status: 'open'},
    });
  });

  it('sets oldImage to undefined for INSERT events', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'INSERT',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              NewImage: {id: {S: 'u1'}, status: {S: 'new'}},
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent, onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    const call = onEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.eventName).toBe('INSERT');
    expect(call.image).toEqual({id: 'u1', status: 'new'});
    expect(call.oldImage).toBeUndefined();
  });

  it('populates oldImage for REMOVE events when OldImage is present', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'REMOVE',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              OldImage: {id: {S: 'u1'}, status: {S: 'deleted'}},
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    poller.addListener({eventTypes: ['REMOVE'], onEvent, onError: vi.fn()});

    await vi.advanceTimersByTimeAsync(0);

    const call = onEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.eventName).toBe('REMOVE');
    expect(call.image).toEqual({id: 'u1', status: 'deleted'});
    expect(call.oldImage).toEqual({id: 'u1', status: 'deleted'});
  });

  it('filters MODIFY events by field condition (from + to)', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'MODIFY',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              OldImage: {id: {S: 'u1'}, status: {S: 'open'}},
              NewImage: {id: {S: 'u1'}, status: {S: 'overdue'}},
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const matchingListener = vi.fn();
    const nonMatchingListener = vi.fn();
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: matchingListener,
      onError: vi.fn(),
      filter: {status: {from: 'open', to: 'overdue'}},
    });
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: nonMatchingListener,
      onError: vi.fn(),
      filter: {status: {from: 'open', to: 'cancelled'}},
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(matchingListener).toHaveBeenCalledTimes(1);
    expect(nonMatchingListener).not.toHaveBeenCalled();
  });

  it('filters with array values (OR) for from and to', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'MODIFY',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              OldImage: {id: {S: 'u1'}, status: {S: 'pending'}},
              NewImage: {id: {S: 'u1'}, status: {S: 'overdue'}},
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent,
      onError: vi.fn(),
      filter: {status: {from: ['open', 'pending'], to: 'overdue'}},
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('does not apply filter to INSERT events (no oldImage to compare)', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'INSERT',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              NewImage: {id: {S: 'u1'}, status: {S: 'new'}},
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEvent = vi.fn();
    // filter references oldImage (from) which is undefined for INSERT
    poller.addListener({
      eventTypes: ['INSERT'],
      onEvent,
      onError: vi.fn(),
      filter: {status: {from: 'open', to: 'new'}},
    });

    await vi.advanceTimersByTimeAsync(0);

    // from check fails because oldImage is undefined -> event not delivered
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('filters with to only (no from) — matches when new value equals to', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'MODIFY',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              OldImage: {id: {S: 'u1'}, status: {S: 'anything'}},
              NewImage: {id: {S: 'u1'}, status: {S: 'overdue'}},
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const matching = vi.fn();
    const nonMatching = vi.fn();
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: matching,
      onError: vi.fn(),
      filter: {status: {to: 'overdue'}}, // no from
    });
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: nonMatching,
      onError: vi.fn(),
      filter: {status: {to: 'cancelled'}}, // no from
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(matching).toHaveBeenCalledTimes(1);
    expect(nonMatching).not.toHaveBeenCalled();
  });

  it('filters with from only (no to) — matches when old value equals from', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'MODIFY',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              OldImage: {id: {S: 'u1'}, status: {S: 'open'}},
              NewImage: {id: {S: 'u1'}, status: {S: 'anything'}},
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const matching = vi.fn();
    const nonMatching = vi.fn();
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: matching,
      onError: vi.fn(),
      filter: {status: {from: 'open'}}, // no to
    });
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: nonMatching,
      onError: vi.fn(),
      filter: {status: {from: 'banned'}}, // no to
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(matching).toHaveBeenCalledTimes(1);
    expect(nonMatching).not.toHaveBeenCalled();
  });

  it('filters with to as array (OR) — matches when new value is in the array', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});
    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'MODIFY',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              OldImage: {id: {S: 'u1'}, status: {S: 'open'}},
              NewImage: {id: {S: 'u1'}, status: {S: 'overdue'}},
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const matching = vi.fn();
    const nonMatching = vi.fn();
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: matching,
      onError: vi.fn(),
      filter: {status: {from: 'open', to: ['overdue', 'cancelled']}}, // to is array
    });
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: nonMatching,
      onError: vi.fn(),
      filter: {status: {from: 'open', to: ['cancelled']}}, // to is array, no match
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(matching).toHaveBeenCalledTimes(1);
    expect(nonMatching).not.toHaveBeenCalled();
  });

  it('filters deep equality values (nested objects, Dates, and unmatched keys)', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});

    const date1 = new Date('2026-01-01T00:00:00.000Z');
    const date2 = new Date('2026-01-02T00:00:00.000Z');

    client.getRecords
      .mockResolvedValueOnce({
        Records: [
          {
            eventID: 'evt-1',
            eventName: 'MODIFY',
            dynamodb: {
              Keys: {id: {S: 'u1'}},
              OldImage: {
                __test_custom_image: {
                  id: 'u1',
                  created: date1,
                  meta: {tag: 'old'},
                },
              } as any,
              NewImage: {
                __test_custom_image: {
                  id: 'u1',
                  created: date1,
                  meta: {tag: 'new'},
                },
              } as any,
            },
          },
        ],
        NextShardIterator: 'iter-2',
      })
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');

    const matching = vi.fn();
    const nonMatchingDate = vi.fn();
    const nonMatchingLength = vi.fn();
    const nonMatchingKeys = vi.fn();
    const nonMatchingValues = vi.fn();

    // 1. Matches successfully
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: matching,
      onError: vi.fn(),
      filter: {
        created: {from: date1, to: date1},
        meta: {from: {tag: 'old'}, to: {tag: 'new'}},
      },
    });

    // 2. Fails to match because date is different
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: nonMatchingDate,
      onError: vi.fn(),
      filter: {
        created: {to: date2},
      },
    });

    // 3. Fails to match because object keys length is different
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: nonMatchingLength,
      onError: vi.fn(),
      filter: {
        meta: {to: {tag: 'new', other: 1}},
      },
    });

    // 4. Fails to match because object keys do not match
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: nonMatchingKeys,
      onError: vi.fn(),
      filter: {
        meta: {to: {otherTag: 'new'}},
      },
    });

    // 5. Fails to match because key values inside object do not match
    poller.addListener({
      eventTypes: ['MODIFY'],
      onEvent: nonMatchingValues,
      onError: vi.fn(),
      filter: {
        meta: {to: {tag: 'incorrect_value'}},
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(matching).toHaveBeenCalledTimes(1);
    expect(nonMatchingDate).not.toHaveBeenCalled();
    expect(nonMatchingLength).not.toHaveBeenCalled();
    expect(nonMatchingKeys).not.toHaveBeenCalled();
    expect(nonMatchingValues).not.toHaveBeenCalled();
  });
});

describe('StreamPoller — generation-based staleness on rapid unsubscribe/resubscribe', () => {
  it('does not spawn a duplicate reader, and discards stale records, on rapid unsubscribe -> resubscribe', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});

    let resolveStaleGetRecords!: (value: {Records?: StreamRecordLike[]; NextShardIterator?: string}) => void;
    const staleGetRecordsPromise = new Promise<{Records?: StreamRecordLike[]; NextShardIterator?: string}>(resolve => {
      resolveStaleGetRecords = resolve;
    });
    client.getRecords
      .mockImplementationOnce(() => staleGetRecordsPromise)
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onEventOriginal = vi.fn();
    const unsubscribe = poller.addListener({eventTypes: ['INSERT'], onEvent: onEventOriginal, onError: vi.fn()});

    // Let the first generation's rescan acquire an iterator and call getRecords, which
    // stays pending (simulating a suspended network call).
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getShardIterator).toHaveBeenCalledTimes(1);
    expect(client.getRecords).toHaveBeenCalledTimes(1);

    // Last listener removed -> #stop() bumps the generation and clears #activeShards,
    // even though the original reader is still suspended inside getRecords.
    unsubscribe();

    // Immediately resubscribe -> #start() runs again, spawning a fresh rescan for the
    // same still-open shard.
    const onEventNew = vi.fn();
    poller.addListener({eventTypes: ['INSERT'], onEvent: onEventNew, onError: vi.fn()});

    // Let the new generation's rescan acquire its own shard iterator and call getRecords.
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getShardIterator).toHaveBeenCalledTimes(2);

    // Now resolve the ORIGINAL (stale) getRecords call with some records.
    resolveStaleGetRecords({
      Records: [{eventName: 'INSERT', dynamodb: {NewImage: {id: {S: 'stale'}}}}],
      NextShardIterator: 'iter-stale-2',
    });
    await vi.advanceTimersByTimeAsync(0);

    // The stale reader must be a complete no-op: no dispatch to either listener, and no
    // corrupted #activeShards state causing a third getShardIterator call.
    expect(onEventOriginal).not.toHaveBeenCalled();
    expect(onEventNew).not.toHaveBeenCalled();
    expect(client.getShardIterator).toHaveBeenCalledTimes(2);
  });

  it('a stale rescan whose describeStream resolves after a stop becomes a no-op', async () => {
    const client = makeClient();
    let resolveDescribeStream!: (value: Awaited<ReturnType<DynamoDBStreamsLike['describeStream']>>) => void;
    const pendingDescribeStream = new Promise<Awaited<ReturnType<DynamoDBStreamsLike['describeStream']>>>(resolve => {
      resolveDescribeStream = resolve;
    });
    client.describeStream.mockReturnValueOnce(pendingDescribeStream);
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: []}});

    const poller = new StreamPoller(client, 'arn:test');
    const unsubscribe = poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError: vi.fn()});

    // The first rescan's describeStream call is now in flight (pending). Stop immediately,
    // bumping the generation before that call resolves.
    unsubscribe();

    // Resolve the stale describeStream call now that the poller has moved on.
    resolveDescribeStream({StreamDescription: {Shards: [OPEN_SHARD]}});
    await vi.advanceTimersByTimeAsync(0);

    // The stale rescan must bail out before processing any shards.
    expect(client.getShardIterator).not.toHaveBeenCalled();
  });

  it('a stale reader whose getRecords rejects after a stop does not dispatch the error', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});
    client.getShardIterator.mockResolvedValue({ShardIterator: 'iter-1'});

    let rejectStaleGetRecords!: (err: unknown) => void;
    const staleGetRecordsPromise = new Promise<Awaited<ReturnType<DynamoDBStreamsLike['getRecords']>>>(
      (_resolve, reject) => {
        rejectStaleGetRecords = reject;
      }
    );
    client.getRecords
      .mockImplementationOnce(() => staleGetRecordsPromise)
      .mockResolvedValue({Records: [], NextShardIterator: 'iter-2'});

    const poller = new StreamPoller(client, 'arn:test');
    const onError = vi.fn();
    const unsubscribe = poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError});

    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();

    rejectStaleGetRecords(new Error('stale failure'));
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).not.toHaveBeenCalled();
  });

  it('a stale reader whose initial getShardIterator rejects after a stop does not dispatch the error', async () => {
    const client = makeClient();
    client.describeStream.mockResolvedValue({StreamDescription: {Shards: [OPEN_SHARD]}});

    let rejectStaleGetShardIterator!: (err: unknown) => void;
    const staleGetShardIteratorPromise = new Promise<Awaited<ReturnType<DynamoDBStreamsLike['getShardIterator']>>>(
      (_resolve, reject) => {
        rejectStaleGetShardIterator = reject;
      }
    );
    client.getShardIterator.mockReturnValueOnce(staleGetShardIteratorPromise);

    const poller = new StreamPoller(client, 'arn:test');
    const onError = vi.fn();
    const unsubscribe = poller.addListener({eventTypes: ['INSERT'], onEvent: vi.fn(), onError});

    // Let the rescan discover the shard and start acquiring its iterator (pending).
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getShardIterator).toHaveBeenCalledTimes(1);

    unsubscribe();

    rejectStaleGetShardIterator(new Error('stale iterator failure'));
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).not.toHaveBeenCalled();
  });
});
