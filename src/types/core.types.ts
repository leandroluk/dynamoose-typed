// ─── Primitives ───────────────────────────────────────────────────────────────

export type Ctor<T = unknown> = new (...args: unknown[]) => T;
export type LazyType<T = unknown> = () => Ctor<T>;
export type AnyRecord = Record<string, unknown>;
export type AnyItem = object;

/** Composite key — hash + optional range. */
export type ItemKey<T> = Partial<T>;

/** Partial key used in get/delete/update operations. */
export type KeyInput<T> = Partial<T>;

// ─── Query options ────────────────────────────────────────────────────────────

export interface FindOptions {
  /** Include soft-deleted items in results. */
  withDeleted?: boolean;
  limit?: number;
  startAt?: AnyRecord;
  consistent?: boolean;
}

export interface CountOptions {
  withDeleted?: boolean;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export type HookFn<T> = (item: T) => void | Promise<void>;

export interface TableHooks<T> {
  beforeInsert?: HookFn<T>;
  afterInsert?: HookFn<T>;
  beforeUpdate?: HookFn<T>;
  afterUpdate?: HookFn<T>;
  beforeDelete?: HookFn<T>;
  afterDelete?: HookFn<T>;
}

// ─── Transform options ────────────────────────────────────────────────────────

export interface TransformOptions<T> {
  get?: (value: T) => T;
  set?: (value: T) => T;
}

// ─── Timestamp attribute type options ────────────────────────────────────────

export type TimestampStorageType = StringConstructor | NumberConstructor | DateConstructor;

export interface TimestampOptions extends TransformOptions<Date> {
  /** Storage type: String (ISO), Number (epoch ms), Date (native). Default: Date. */
  type?: TimestampStorageType;
  [key: string]: unknown;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  count: number;
  lastKey?: AnyRecord;
}
