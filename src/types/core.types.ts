// ─── Primitives ───────────────────────────────────────────────────────────────

/**
 * Represents a class constructor function.
 * Useful for type definitions requiring class reference instantiation.
 *
 * @template T The instance type produced by the constructor.
 */
export type Ctor<T = unknown> = new (...args: unknown[]) => T;

/**
 * A lazy reference getter function that returns a class constructor.
 * Typically used to prevent circular dependencies in decorator metadata initialization.
 *
 * @template T The class constructor instance type.
 */
export type LazyType<T = unknown> = () => Ctor<T>;

/**
 * A general key-value map representing a record of unknown values with string keys.
 */
export type AnyRecord = Record<string, unknown>;

/**
 * Represents an arbitrary non-primitive object.
 */
export type AnyItem = object;

/**
 * Represents a composite key structure of an entity.
 * It contains a partition (hash) key and an optional sort (range) key.
 *
 * @template T The entity type.
 */
export type ItemKey<T> = Partial<T>;

/**
 * Represents a partial key input used for DynamoDB retrieval, update, or deletion operations.
 *
 * @template T The entity type.
 */
export type KeyInput<T> = Partial<T>;

// ─── Query options ────────────────────────────────────────────────────────────

/**
 * Sort key (range key) condition for `find()` queries.
 * Only one condition should be set per call.
 */
export interface SortKeyCondition {
  eq?: string | number;
  lt?: string | number;
  lte?: string | number;
  gt?: string | number;
  gte?: string | number;
  between?: [string | number, string | number];
  beginsWith?: string;
}

/**
 * Server-side filter condition for a single attribute.
 * Only one condition should be set per entry.
 * Applied as a DynamoDB FilterExpression — evaluated after key conditions,
 * reducing transferred data without reducing consumed read capacity.
 */
export interface FilterCondition {
  eq?: unknown;
  ne?: unknown;
  lt?: string | number;
  lte?: string | number;
  gt?: string | number;
  gte?: string | number;
  between?: [string | number, string | number];
  beginsWith?: string;
  contains?: string | number;
  /** `true` = attribute must exist; `false` = attribute must not exist. */
  exists?: boolean;
  in?: unknown[];
}

/**
 * Options used to customize find, query, and scan retrieval operations.
 */
export interface FindOptions {
  /**
   * If true, soft-deleted items (items with a non-null delete date attribute) will be included in the results.
   * Defaults to false.
   */
  withDeleted?: boolean;

  /**
   * Maximum number of items to evaluate and return in the request.
   */
  limit?: number;

  /**
   * The exclusive start key to resume a previous paginated query or scan.
   */
  startAt?: AnyRecord;

  /**
   * If true, performs a strongly consistent read rather than an eventually consistent read.
   */
  consistent?: boolean;

  /**
   * Optional sort key (range key) condition. Evaluated after the hash key equality filter.
   * Requires the table to have a `rangeKey` defined.
   */
  sortKey?: SortKeyCondition;

  /**
   * Server-side filter expressions applied to non-key attributes.
   * Keys are TypeScript property names (alias-aware). Multiple entries are AND'd.
   *
   * @example
   * { filter: { age: { gt: 18 }, status: { eq: 'active' } } }
   */
  filter?: Record<string, FilterCondition>;
}

/**
 * Options used to customize counting operations.
 */
export interface CountOptions {
  /**
   * If true, soft-deleted items will be included in the total count.
   * Defaults to false.
   */
  withDeleted?: boolean;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * A life-cycle hook function signature.
 * Receives the target entity instance and can optionally return a Promise for asynchronous operations.
 *
 * @template T The entity type.
 */
export type HookFn<T> = (item: T) => void | Promise<void>;

/**
 * Life-cycle hooks available for entities, matching persistent events.
 *
 * @template T The entity type.
 */
export interface TableHooks<T> {
  /**
   * Fired before a new item is persisted to the database.
   */
  beforeInsert?: HookFn<T>;

  /**
   * Fired after a new item is successfully persisted to the database.
   */
  afterInsert?: HookFn<T>;

  /**
   * Fired before an existing item is updated.
   */
  beforeUpdate?: HookFn<T>;

  /**
   * Fired after an existing item is successfully updated.
   */
  afterUpdate?: HookFn<T>;

  /**
   * Fired before an item is deleted (or soft-deleted).
   */
  beforeDelete?: HookFn<T>;

  /**
   * Fired after an item is successfully deleted (or soft-deleted).
   */
  afterDelete?: HookFn<T>;
}

// ─── Transform options ────────────────────────────────────────────────────────

/**
 * Defines custom transform functions applied when retrieving or saving property values.
 *
 * @template T The property value type.
 */
export interface TransformOptions<T> {
  /**
   * Invoked when retrieving a value from DynamoDB to the application code.
   * Useful for converting underlying DB types to rich JavaScript objects.
   */
  get?: (value: T) => T;

  /**
   * Invoked when writing a value from the application code to DynamoDB.
   * Useful for converting rich JavaScript objects to database primitives.
   */
  set?: (value: T) => T;
}

// ─── Timestamp attribute type options ────────────────────────────────────────

/**
 * Storage format for date/timestamp attributes.
 * - `'epoch'`: Persisted as epoch milliseconds (Number). Default.
 * - `'iso'`: Persisted as an ISO-8601 string (String).
 */
export type DateFormat = 'iso' | 'epoch';

/**
 * Options used to customize timestamp attributes like `@CreateDateAttribute` and `@UpdateDateAttribute`.
 */
export interface TimestampOptions extends TransformOptions<Date> {
  /**
   * Storage format in DynamoDB.
   * - `'epoch'` (epoch milliseconds) — default
   * - `'iso'` (ISO-8601 string)
   */
  format?: DateFormat;

  /**
   * If true, creates a DynamoDB Global Secondary Index (GSI) on this attribute.
   * The default GSI name is `${attributeName}GlobalIndex`.
   */
  index?: boolean;

  /**
   * Additional Dynamoose-compatible attribute parameters.
   */
  [key: string]: unknown;
}

// ─── Write options ────────────────────────────────────────────────────────────

/**
 * Options accepted by write operations (`save`, `update`).
 */
export interface WriteOptions {
  /**
   * Server-side condition that must be satisfied for the write to succeed.
   * Keys are TypeScript property names (alias-aware). Multiple entries are AND'd.
   * On failure, DynamoDB throws `ConditionalCheckFailedException`.
   */
  condition?: Record<string, FilterCondition>;
}

// ─── Projection ──────────────────────────────────────────────────────────────

/**
 * Maps entity property keys to optional `true` values for projection.
 * Pass to `find()`, `scan()`, and related methods to select a subset of attributes.
 */
export type SelectMap<T> = {readonly [K in keyof T]?: true};

/**
 * Narrows an entity type `T` to only the keys present in `S`.
 * When `S` is `undefined`, resolves to the full entity type `T`.
 */
export type Projected<T, S extends SelectMap<T> | undefined = undefined> = [S] extends [undefined]
  ? T
  : Pick<T, Extract<keyof NonNullable<S>, keyof T>>;

// ─── Pagination ───────────────────────────────────────────────────────────────

/**
 * Structure of the response returned by paginated scan and query operations.
 *
 * @template T The entity type.
 */
export interface PaginatedResult<T> {
  /**
   * The array of retrieved entity instances.
   */
  items: T[];

  /**
   * The count of items matching the query criteria in this page.
   */
  count: number;

  /**
   * The pagination evaluation key. Pass this to `FindOptions.startAt` to retrieve the next page of results.
   */
  lastKey?: AnyRecord;
}
