import type {AttributeValue} from '@aws-sdk/client-dynamodb';
import type {StreamEventType} from '#/types';
import {unmarshall} from '@aws-sdk/util-dynamodb';

const POLL_DELAY_WITH_RECORDS_MS = 100;
const POLL_DELAY_EMPTY_MS = 1000;
const POLL_DELAY_ERROR_MS = 1000;
const RESCAN_INTERVAL_MS = 60_000;

type ShardIteratorType = 'LATEST' | 'TRIM_HORIZON';

export interface StreamShard {
  ShardId: string;
  ParentShardId?: string;
  SequenceNumberRange?: {EndingSequenceNumber?: string};
}

export interface StreamRecordLike {
  eventID?: string;
  eventName?: string;
  dynamodb?: {
    Keys?: Record<string, AttributeValue>;
    NewImage?: Record<string, AttributeValue>;
    OldImage?: Record<string, AttributeValue>;
    ApproximateCreationDateTime?: Date;
    SequenceNumber?: string;
  };
}

export interface DynamoDBStreamsLike {
  describeStream(input: {StreamArn: string}): Promise<{StreamDescription?: {Shards?: StreamShard[]}}>;
  getShardIterator(input: {
    StreamArn: string;
    ShardId: string;
    ShardIteratorType: ShardIteratorType;
  }): Promise<{ShardIterator?: string}>;
  getRecords(input: {ShardIterator: string}): Promise<{Records?: StreamRecordLike[]; NextShardIterator?: string}>;
}

export interface RawStreamEvent {
  eventId: string;
  eventName: StreamEventType;
  image: Record<string, unknown>;
  oldImage?: Record<string, unknown>;
  approximateCreationDateTime?: Date;
  sequenceNumber?: string;
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
  #generation = 0;
  #isFirstRescan = true;

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
    this.#isFirstRescan = true;
    void this.#rescan();
    this.#rescanTimer = setInterval(() => void this.#rescan(), RESCAN_INTERVAL_MS);
  }

  #stop(): void {
    this.#generation++;
    this.#activeShards.clear();
    clearInterval(this.#rescanTimer);
    this.#rescanTimer = undefined;
  }

  async #rescan(): Promise<void> {
    const generation = this.#generation;
    let shards: StreamShard[];
    try {
      const result = await this.#client.describeStream({StreamArn: this.#streamArn});
      shards = result.StreamDescription?.Shards ?? [];
    } catch (err) {
      this.#dispatchError(err);
      return;
    }
    if (generation !== this.#generation) {
      return;
    }
    const iteratorType: ShardIteratorType = this.#isFirstRescan ? 'LATEST' : 'TRIM_HORIZON';
    this.#isFirstRescan = false;
    for (const shard of shards) {
      const isOpen = !shard.SequenceNumberRange?.EndingSequenceNumber;
      if (isOpen && !this.#activeShards.has(shard.ShardId)) {
        this.#activeShards.add(shard.ShardId);
        void this.#readShard(shard.ShardId, generation, iteratorType);
      }
    }
  }

  async #readShard(shardId: string, generation: number, initialIteratorType: ShardIteratorType): Promise<void> {
    let iterator: string | undefined;
    try {
      const acquired = await this.#client.getShardIterator({
        StreamArn: this.#streamArn,
        ShardId: shardId,
        ShardIteratorType: initialIteratorType,
      });
      iterator = acquired.ShardIterator;
    } catch (err) {
      if (generation === this.#generation) {
        this.#dispatchError(err);
        this.#activeShards.delete(shardId);
      }
      return;
    }

    while (generation === this.#generation && iterator) {
      let recordsResult: {Records?: StreamRecordLike[]; NextShardIterator?: string};
      try {
        recordsResult = await this.#client.getRecords({ShardIterator: iterator});
      } catch (err) {
        if (generation !== this.#generation) {
          return;
        }
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

      // A stale reader (from a prior start/stop generation) must become a complete
      // no-op as soon as it resumes from this await — it must not dispatch records
      // or touch #activeShards, even though the promise it was awaiting has resolved.
      if (generation !== this.#generation) {
        return;
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

    if (generation === this.#generation) {
      this.#activeShards.delete(shardId);
      void this.#rescan();
    }
  }

  #dispatchRecord(record: StreamRecordLike): void {
    const eventName = record.eventName as StreamEventType;
    const rawNewImage = record.dynamodb?.NewImage;
    const rawOldImage = record.dynamodb?.OldImage;
    const rawImage = eventName === 'REMOVE' ? rawOldImage : rawNewImage;
    const image = rawImage ? unmarshall(rawImage) : unmarshall(record.dynamodb?.Keys ?? {});
    // For MODIFY and REMOVE events: oldImage is the item before change/deletion.
    // For INSERT: oldImage is undefined (no previous state exists).
    const oldImage =
      (eventName === 'MODIFY' || eventName === 'REMOVE') && rawOldImage ? unmarshall(rawOldImage) : undefined;
    const event: RawStreamEvent = {
      eventId: record.eventID ?? '',
      eventName,
      image,
      oldImage,
      approximateCreationDateTime: record.dynamodb?.ApproximateCreationDateTime,
      sequenceNumber: record.dynamodb?.SequenceNumber,
    };
    for (const listener of this.#listeners) {
      if (!listener.eventTypes.includes(eventName)) {
        continue;
      }
      try {
        Promise.resolve(listener.onEvent(event)).catch(err => listener.onError(err));
      } catch (err) {
        listener.onError(err);
      }
    }
  }

  #dispatchError(err: unknown): void {
    for (const listener of this.#listeners) {
      listener.onError(err);
    }
  }
}
