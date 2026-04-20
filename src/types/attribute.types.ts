import type {LazyType, TimestampStorageType, TransformOptions} from './core.types';

export interface BaseAttributeOptions {
  /** Override the DynamoDB attribute name (column alias). */
  alias?: string;
  required?: boolean;
  default?: unknown | (() => unknown);
  validate?: (value: unknown) => boolean | Promise<boolean>;
  [key: string]: unknown;
}

export interface StringAttributeOptions extends BaseAttributeOptions, TransformOptions<string> {
  hashKey?: boolean;
  rangeKey?: boolean;
  /** Also used as sort key (alias for rangeKey). */
  sortKey?: boolean;
  minLength?: number;
  maxLength?: number;
  trim?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  enum?: readonly string[];
}

export interface NumberAttributeOptions extends BaseAttributeOptions, TransformOptions<number> {
  hashKey?: boolean;
  rangeKey?: boolean;
  min?: number;
  max?: number;
}

export interface BooleanAttributeOptions extends BaseAttributeOptions, TransformOptions<boolean> {}

export interface DateAttributeOptions extends BaseAttributeOptions, TransformOptions<Date> {
  /** Storage type: String (ISO), Number (epoch ms), Date (native). */
  type?: TimestampStorageType;
}

export interface NestedAttributeOptions extends BaseAttributeOptions, TransformOptions<object> {}

export interface ArrayAttributeOptions extends BaseAttributeOptions, TransformOptions<unknown[]> {}

export interface SetAttributeOptions extends BaseAttributeOptions, TransformOptions<Set<unknown>> {}

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

export interface StoredAttributeMeta {
  propertyKey: string;
  /** DynamoDB attribute name (may differ from propertyKey via alias). */
  attributeName: string;
  kind: AttributeKind;
  options: Record<string, unknown>;
  /** For nested / array / set — lazy reference to the element type. */
  typeRef?: LazyType;
  /** For timestamp attributes — storage type. */
  timestampType?: TimestampStorageType;
  isHashKey?: boolean;
  isRangeKey?: boolean;
}
