import type {StoredAttributeMeta} from './attribute.types';
import type {TableHooks} from './core.types';

// ─── Schema Options ───────────────────────────────────────────────────────────

export interface SchemaOptions {
  saveUnknown?: boolean | string[];
}

// ─── @DynamoDocument options ──────────────────────────────────────────────────

export interface DocumentOptions extends SchemaOptions {}

// ─── @DynamoTable options ─────────────────────────────────────────────────────

export interface TableOptions<T = unknown> extends SchemaOptions {
  hooks?: TableHooks<T>;
}

// ─── Stored metadata ──────────────────────────────────────────────────────────

export interface TableMeta {
  tableName: string;
  options: TableOptions;
  /** Resolved attribute list (populated after all decorators run). */
  attributes: StoredAttributeMeta[];
  hashKey?: string;
  rangeKey?: string;
  /** Property key of @DeleteDateAttribute, if any. */
  deleteDateKey?: string;
}

export interface DocumentMeta {
  options: DocumentOptions;
  attributes: StoredAttributeMeta[];
}
