import type {AttributeValue} from '@aws-sdk/client-dynamodb';
import type {StreamEventType} from '#/types';
import {unmarshall} from '@aws-sdk/util-dynamodb';

const POLL_DELAY_WITH_RECORDS_MS = 100;
const POLL_DELAY_EMPTY_MS = 1000;
const POLL_DELAY_ERROR_MS = 1000;
const RESCAN_INTERVAL_MS = 60_000;

export interface StreamShard {
  ShardId: string;
  ParentShardId?: string;
  SequenceNumberRange?: {EndingSequenceNumber?: string};
}

export interface StreamRecordLike {
  eventName?: string;
  dynamodb?: {
    Keys?: Record<string, AttributeValue>;
    NewImage?: Record<string, AttributeValue>;
    OldImage?: Record<string, AttributeValue>;
  };
}

export interface DynamoDBStreamsLike {
  describeStream(input: {StreamArn: string}): Promise<{StreamDescription?: {Shards?: StreamShard[]}}>;
  getShardIterator(input: {
    StreamArn: string;
    ShardId: string;
    ShardIteratorType: 'LATEST';
  }): Promise<{ShardIterator?: string}>;
  getRecords(input: {ShardIterator: string}): Promise<{Records?: StreamRecordLike[]; NextShardIterator?: string}>;
}

export interface RawStreamEvent {
  eventName: StreamEventType;
  image: Record<string, unknown>;
}

export interface StreamPollerListener {
  eventTypes: StreamEventType[];
  onEvent(event: RawStreamEvent): void | Promise<void>;
  onError: (err: unknown) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Polls a DynamoDB Streams ARN across all open shards and fans out records to every
 * attached listener, filtered by `eventTypes`. One instance is shared across every
 * `subscribe()` call for a given table (see `InternalModel.getStreamPoller()`).
 */
export class StreamPoller {
  readonly #client: DynamoDBStreamsLike;
  readonly #streamArn: string;
  readonly #listeners = new Set<StreamPollerListener>();
  readonly #activeShards = new Set<string>();
  #rescanTimer: ReturnType<typeof setInterval> | undefined;
  #stopped = true;

  constructor(client: DynamoDBStreamsLike, streamArn: string) {
    this.#client = client;
    this.#streamArn = streamArn;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  addListener(listener: StreamPollerListener): () => void {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      this.#start();
    }
    return (): void => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#stop();
      }
    };
  }

  #start(): void {
    this.#stopped = false;
    void this.#rescan();
    this.#rescanTimer = setInterval(() => void this.#rescan(), RESCAN_INTERVAL_MS);
  }

  #stop(): void {
    this.#stopped = true;
    this.#activeShards.clear();
    clearInterval(this.#rescanTimer);
    this.#rescanTimer = undefined;
  }

  async #rescan(): Promise<void> {
    let shards: StreamShard[];
    try {
      const result = await this.#client.describeStream({StreamArn: this.#streamArn});
      shards = result.StreamDescription?.Shards ?? [];
    } catch (err) {
      this.#dispatchError(err);
      return;
    }
    for (const shard of shards) {
      const isOpen = !shard.SequenceNumberRange?.EndingSequenceNumber;
      if (isOpen && !this.#activeShards.has(shard.ShardId)) {
        this.#activeShards.add(shard.ShardId);
        void this.#readShard(shard.ShardId);
      }
    }
  }

  async #readShard(shardId: string): Promise<void> {
    let iterator: string | undefined;
    try {
      const acquired = await this.#client.getShardIterator({
        StreamArn: this.#streamArn,
        ShardId: shardId,
        ShardIteratorType: 'LATEST',
      });
      iterator = acquired.ShardIterator;
    } catch (err) {
      this.#dispatchError(err);
      this.#activeShards.delete(shardId);
      return;
    }

    while (!this.#stopped && iterator) {
      let recordsResult: {Records?: StreamRecordLike[]; NextShardIterator?: string};
      try {
        recordsResult = await this.#client.getRecords({ShardIterator: iterator});
      } catch (err) {
        if ((err as {name?: string}).name === 'ExpiredIteratorException') {
          try {
            const reacquired = await this.#client.getShardIterator({
              StreamArn: this.#streamArn,
              ShardId: shardId,
              ShardIteratorType: 'LATEST',
            });
            iterator = reacquired.ShardIterator;
          } catch (reacquireErr) {
            this.#dispatchError(reacquireErr);
            iterator = undefined;
          }
          continue;
        }
        this.#dispatchError(err);
        await delay(POLL_DELAY_ERROR_MS);
        continue;
      }

      const records = recordsResult.Records ?? [];
      for (const record of records) {
        this.#dispatchRecord(record);
      }

      iterator = recordsResult.NextShardIterator;
      if (!iterator) {
        break;
      }
      await delay(records.length > 0 ? POLL_DELAY_WITH_RECORDS_MS : POLL_DELAY_EMPTY_MS);
    }

    this.#activeShards.delete(shardId);
    if (!this.#stopped) {
      void this.#rescan();
    }
  }

  #dispatchRecord(record: StreamRecordLike): void {
    const eventName = record.eventName as StreamEventType;
    const rawImage = eventName === 'REMOVE' ? record.dynamodb?.OldImage : record.dynamodb?.NewImage;
    const image = rawImage ? unmarshall(rawImage) : unmarshall(record.dynamodb?.Keys ?? {});
    const event: RawStreamEvent = {eventName, image};
    for (const listener of this.#listeners) {
      if (listener.eventTypes.includes(eventName)) {
        try {
          Promise.resolve(listener.onEvent(event)).catch(err => listener.onError(err));
        } catch (err) {
          listener.onError(err);
        }
      }
    }
  }

  #dispatchError(err: unknown): void {
    for (const listener of this.#listeners) {
      listener.onError(err);
    }
  }
}
