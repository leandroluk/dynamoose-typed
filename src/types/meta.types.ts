import type {StoredAttributeMeta} from './attribute.types';
import type {TableHooks} from './core.types';

// ─── Throughput ───────────────────────────────────────────────────────────────

/**
 * DynamoDB billing mode for a table.
 * - `'ON_DEMAND'` — pay-per-request, no capacity planning needed
 * - `number` — same capacity applied to both read and write
 * - `{ read, write }` — separate read/write provisioned capacity units
 */
export type ThroughputOptions = 'ON_DEMAND' | number | {read: number; write: number};

// ─── Schema Options ───────────────────────────────────────────────────────────

/**
 * Common configuration options at the schema level in Dynamoose.
 */
export interface SchemaOptions {
  /**
   * Defines whether properties not explicitly declared in the schema should be saved to the database.
   * - `true`: Unknown fields are saved.
   * - `false`: Unknown fields are ignored and stripped on save.
   * - `string[]`: Array of property keys that are allowed to be saved even if not declared.
   */
  saveUnknown?: boolean | string[];
}

// ─── @DynamoDocument options ──────────────────────────────────────────────────

/**
 * Configuration options specifically for `@DynamoDocument` classes.
 * Inherits schema options like `saveUnknown`.
 */
export interface DocumentOptions extends SchemaOptions {}

// ─── @DynamoTable options ─────────────────────────────────────────────────────

/**
 * Configuration options specifically for `@DynamoTable` classes.
 * Includes hooks in addition to generic schema configurations.
 *
 * @template T The entity class type.
 */
export interface TableOptions<T = unknown> extends SchemaOptions {
  /**
   * Life-cycle hooks to execute before or after insertion, update, or deletion events.
   */
  hooks?: TableHooks<T>;

  /**
   * DynamoDB billing mode for this table.
   * - `'ON_DEMAND'` — pay-per-request, no capacity planning needed
   * - `number` — same value used for both read and write capacity units
   * - `{ read, write }` — separate read/write provisioned capacity units
   *
   * Overrides `DataSourceOptions.table.throughput` for this specific table.
   * When omitted, falls back to `DataSourceOptions.table.throughput` if set,
   * otherwise Dynamoose's default applies (read: 5, write: 5).
   *
   * @example
   * @DynamoTable('users', { throughput: 'ON_DEMAND' })
   */
  throughput?: ThroughputOptions;
}

// ─── Stored metadata ──────────────────────────────────────────────────────────

/**
 * Internal metadata collected for a registered `@DynamoTable` class.
 */
export interface TableMeta {
  /**
   * The physical name of the table in DynamoDB.
   */
  tableName: string;

  /**
   * Configured table-level options.
   */
  options: TableOptions;

  /**
   * Resolved list of attributes decorated on the entity.
   * This is fully populated once all decorators have run.
   */
  attributes: StoredAttributeMeta[];

  /**
   * The property name serving as the hash (partition) key.
   */
  hashKey?: string;

  /**
   * The property name serving as the range (sort) key, if any.
   */
  rangeKey?: string;

  /**
   * The property name decorated with `@DeleteDateAttribute` (for soft deletes), if any.
   */
  deleteDateKey?: string;
}

/**
 * Internal metadata collected for a registered `@DynamoDocument` class.
 */
export interface DocumentMeta {
  /**
   * Configured document-level options.
   */
  options: DocumentOptions;

  /**
   * Resolved list of attributes decorated on the nested document.
   */
  attributes: StoredAttributeMeta[];
}
