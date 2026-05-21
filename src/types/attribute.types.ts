import type {DateFormat, LazyType, TransformOptions} from './core.types';

/**
 * Base options applicable to all types of entity attributes in dynamoose-typed.
 */
export interface BaseAttributeOptions {
  /**
   * Override the DynamoDB attribute name (column alias).
   * Maps a TypeScript class property name to a different column name in the database.
   */
  alias?: string;

  /**
   * If true, Dynamoose guarantees this attribute is present when saving or updating.
   */
  required?: boolean;

  /**
   * A default value, or a function returning a default value, applied when the attribute is not provided.
   */
  default?: unknown | (() => unknown);

  /**
   * A synchronous or asynchronous validator function.
   * Receives the attribute value and returns a boolean (or promise resolving to boolean) representing whether it is valid.
   */
  validate?: (value: unknown) => boolean | Promise<boolean>;

  /**
   * If true, creates a DynamoDB Global Secondary Index (GSI) on this attribute.
   * The default GSI name is `${attributeName}GlobalIndex`.
   */
  index?: boolean;

  /**
   * Any additional Dynamoose attribute configuration settings.
   */
  [key: string]: unknown;
}

/**
 * Configuration options specifically for string-based attributes.
 */
export interface StringAttributeOptions extends BaseAttributeOptions, TransformOptions<string> {
  /**
   * If true, designates this attribute as the table's partition (hash) key.
   */
  hashKey?: boolean;

  /**
   * If true, designates this attribute as the table's sort (range) key.
   */
  rangeKey?: boolean;

  /**
   * An alias for `rangeKey`. Designates this attribute as the table's sort key.
   */
  sortKey?: boolean;

  /**
   * Enforces a minimum length constraint on the string value.
   */
  minLength?: number;

  /**
   * Enforces a maximum length constraint on the string value.
   */
  maxLength?: number;

  /**
   * If true, automatically trims leading and trailing whitespace from the string before saving.
   */
  trim?: boolean;

  /**
   * If true, automatically converts the string value to lowercase before saving.
   */
  lowercase?: boolean;

  /**
   * If true, automatically converts the string value to uppercase before saving.
   */
  uppercase?: boolean;

  /**
   * Enforces that the string value must be one of the specified allowed values.
   */
  enum?: readonly string[];
}

/**
 * Configuration options specifically for numeric attributes.
 */
export interface NumberAttributeOptions extends BaseAttributeOptions, TransformOptions<number> {
  /**
   * If true, designates this attribute as the table's partition (hash) key.
   */
  hashKey?: boolean;

  /**
   * If true, designates this attribute as the table's sort (range) key.
   */
  rangeKey?: boolean;

  /**
   * Enforces a minimum allowed value constraint on the number.
   */
  min?: number;

  /**
   * Enforces a maximum allowed value constraint on the number.
   */
  max?: number;
}

/**
 * Configuration options specifically for boolean attributes.
 */
export interface BooleanAttributeOptions extends BaseAttributeOptions, TransformOptions<boolean> {}

type DateBaseOptions = BaseAttributeOptions & TransformOptions<Date>;

/**
 * Configuration options for `@DateAttribute`.
 *
 * Mutually exclusive branches — a TTL field cannot have an explicit format:
 * - `{ ttl: true }` — epoch **seconds** storage with automatic Date↔seconds transforms.
 *   DynamoDB uses this attribute for item expiry (TTL must be enabled on the table).
 * - `{ format?: 'epoch' | 'iso' }` — epoch milliseconds (default) or ISO-8601 string.
 */
export type DateAttributeOptions = DateBaseOptions &
  ({ttl: true; format?: never} | {ttl?: false | undefined; format?: DateFormat});

/**
 * Configuration options specifically for nested document attributes.
 */
export interface NestedAttributeOptions extends BaseAttributeOptions, TransformOptions<object> {}

/**
 * Configuration options specifically for array attributes.
 */
export interface ArrayAttributeOptions extends BaseAttributeOptions, TransformOptions<unknown[]> {}

/**
 * Configuration options specifically for set attributes.
 */
export interface SetAttributeOptions extends BaseAttributeOptions, TransformOptions<Set<unknown>> {}

/**
 * Supported attribute decorator categories within the library schema resolver.
 */
export type AttributeKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'nested'
  | 'array'
  | 'set'
  | 'createDate'
  | 'updateDate'
  | 'deleteDate';

/**
 * Internal metadata structure representing a processed decorator attribute configuration.
 */
export interface StoredAttributeMeta {
  /**
   * The property name as declared on the TypeScript entity class.
   */
  propertyKey: string;

  /**
   * The actual DynamoDB column/attribute name. May differ from `propertyKey` if an `alias` was specified.
   */
  attributeName: string;

  /**
   * The categorized type or behavior of the attribute.
   */
  kind: AttributeKind;

  /**
   * Resolved raw attribute options passed to the decorator.
   */
  options: Record<string, unknown>;

  /**
   * For complex attributes (nested documents, arrays, sets) — a lazy reference returning the constructor of the element/nested class.
   */
  typeRef?: LazyType;

  /**
   * For date or timestamp attributes — the resolved storage format.
   * `'ttl'` is only valid for `@DateAttribute({ ttl: true })`.
   */
  timestampType?: DateFormat | 'ttl';

  /**
   * Indicates if the attribute is the table's partition (hash) key.
   */
  isHashKey?: boolean;

  /**
   * Indicates if the attribute is the table's sort (range) key.
   */
  isRangeKey?: boolean;
}
