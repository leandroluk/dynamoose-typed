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

/** Parameters accepted by `Repository.subscribe()` / `InMemoryRepository.subscribe()`. */
export interface SubscribeParams<T> {
  /** Which DynamoDB Streams event types to listen for. */
  eventTypes: StreamEventType[];

  /**
   * Invoked for each matching event.
   * `INSERT`/`MODIFY` receive the new item image; `REMOVE` receives the old (pre-delete) item image.
   */
  callback: (item: T) => void | Promise<void>;

  options?: {
    /** Invoked when the underlying stream poller (or the callback itself) throws. Defaults to `console.error`. */
    onError?: (err: unknown) => void;
  };
}
