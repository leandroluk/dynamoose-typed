/** DynamoDB Streams event type — mirrors the stream record's `eventName`. */
export type StreamEventType = 'INSERT' | 'MODIFY' | 'REMOVE';

/**
 * DynamoDB Streams view type for a table.
 * - `'NEW_IMAGE'` — only the new item image
 * - `'OLD_IMAGE'` — only the old item image
 * - `'NEW_AND_OLD_IMAGES'` — both images (recommended — required for `REMOVE` to carry a full item)
 * - `'KEYS_ONLY'` — only the key attributes
 */
export type StreamViewType = 'NEW_IMAGE' | 'OLD_IMAGE' | 'NEW_AND_OLD_IMAGES' | 'KEYS_ONLY';

/** A live subscription to table change events. Call `close()` to stop receiving events. */
export interface Subscription {
  close(): Promise<void>;
}

/**
 * Condition for a single field in `SubscribeParams.options.filter`.
 * Only one condition should be set per entry (`from` and `to` are AND'd).
 * Each value may be a single value or an array of values (OR).
 */
export interface StreamFieldCondition {
  /** Expected old value(s) in `OldImage` (OR if array). Omit to match any old value. */
  from?: unknown | unknown[];
  /** Expected new value(s) in `NewImage` (OR if array). Omit to match any new value. */
  to?: unknown | unknown[];
}

/** Metadata about a stream event, passed alongside the item to `SubscribeParams.callback`. */
export interface StreamEventMeta {
  /** The DynamoDB Streams record's `eventID` (or a synthetic id for `InMemoryRepository`). */
  eventId: string;

  /** Which change triggered this event. */
  eventName: StreamEventType;

  /** When DynamoDB applied the change (or `new Date()` for `InMemoryRepository`). */
  approximateCreationDateTime?: Date;

  /** The shard-ordered sequence number of the record (or a synthetic value for `InMemoryRepository`). */
  sequenceNumber?: string;

  /**
   * The item before the change — only populated for `MODIFY` events when the table is configured
   * with `NEW_AND_OLD_IMAGES` or `OLD_IMAGE` view type.
   * - `INSERT`: always `undefined`
   * - `MODIFY`: the item before modification
   * - `REMOVE`: the (pre-delete) item (same as the first callback argument)
   */
  oldItem?: Record<string, unknown>;
}

/** Parameters accepted by `Repository.subscribe()` / `InMemoryRepository.subscribe()`. */
export interface SubscribeParams<T> {
  /** Which DynamoDB Streams event types to listen for. */
  eventTypes: StreamEventType[];

  /**
   * Invoked for each matching event.
   * `INSERT`/`MODIFY` receive the new item image; `REMOVE` receives the old (pre-delete) item image.
   */
  callback: (item: T, meta: StreamEventMeta) => void | Promise<void>;

  options?: {
    /** Invoked when the underlying stream poller (or the callback itself) throws. Defaults to `console.error`. */
    onError?: (err: unknown) => void;

    /**
     * Optional declarative field-level filter.
     * Only events matching ALL specified field conditions are delivered to the callback.
     * Keys are entity property names (type-safe).
     *
     * @example
     * ```ts
     * // Fire only when status changes from 'open' to 'overdue'
     * filter: { status: { from: 'open', to: 'overdue' } }
     *
     * // Fire when status changes from 'open' OR 'pending' to 'overdue'
     * filter: { status: { from: ['open', 'pending'], to: 'overdue' } }
     * ```
     */
    filter?: Record<string, StreamFieldCondition>;
  };
}
