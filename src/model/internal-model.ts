import {getDocumentMeta, getTableMeta} from '#/decorators/metadata.registry';
import type {ResolvedSchema} from '#/schema';
import {serializeDate} from '#/schema';
import {type DescribeUpdateTableClient, ensureStreamEnabled} from '#/streams/ensure-stream-enabled';
import {type DynamoDBStreamsLike, StreamPoller} from '#/streams/stream-poller';
import type {AnyRecord, StoredAttributeMeta, TableHooks} from '#/types';
import {DynamoDBStreams} from '@aws-sdk/client-dynamodb-streams';
import dynamoose from 'dynamoose';

type TimestampKind = 'createDate' | 'updateDate' | 'deleteDate';

/**
 * Recursively walks `item` and injects timestamp values into every node
 * (root table, nested documents, and arrays of documents) that carries
 * a matching timestamp attribute kind.
 *
 * This is a module-level function so it can be called without a model instance,
 * making it easy to test in isolation.
 */
function injectTimestampsDeep(
  item: AnyRecord,
  attrs: StoredAttributeMeta[],
  kinds: ReadonlyArray<TimestampKind>,
  value: Date | null
): void {
  for (const attr of attrs) {
    if ((kinds as string[]).includes(attr.kind)) {
      const fmt = attr.timestampType as 'iso' | 'epoch';
      (item as Record<string, unknown>)[attr.attributeName] = value === null ? null : serializeDate(value, fmt);
      continue;
    }

    if (attr.kind === 'nested' && attr.typeRef) {
      const child = (item as Record<string, unknown>)[attr.attributeName];
      if (child !== null && child !== undefined && typeof child === 'object' && !Array.isArray(child)) {
        const nestedMeta = getDocumentMeta(attr.typeRef());
        if (nestedMeta) {
          injectTimestampsDeep(child as AnyRecord, nestedMeta.attributes, kinds, value);
        }
      }
      continue;
    }

    if (attr.kind === 'array' && attr.typeRef) {
      const arr = (item as Record<string, unknown>)[attr.attributeName];
      if (Array.isArray(arr)) {
        const elemMeta = getDocumentMeta(attr.typeRef());
        if (elemMeta) {
          for (const elem of arr) {
            if (elem !== null && elem !== undefined && typeof elem === 'object') {
              injectTimestampsDeep(elem as AnyRecord, elemMeta.attributes, kinds, value);
            }
          }
        }
      }
      continue;
    }
  }
}

function isDateKind(kind: string): boolean {
  return kind === 'date' || kind === 'createDate' || kind === 'updateDate' || kind === 'deleteDate';
}

function parseTimestamp(value: unknown, timestampType?: string): unknown {
  if (value === null || value === undefined || value instanceof Date) {
    return value;
  }
  if (timestampType === 'iso') {
    return new Date(value as string);
  }
  if (timestampType === 'ttl') {
    return new Date((value as number) * 1000);
  }
  return new Date(value as number);
}

/**
 * Recursively remaps the keys of a `nested` / `array`-of-documents value.
 *
 * Only key (alias) renaming is performed — Dynamoose's schema `get`/`set`
 * functions handle nested date (de)serialization at every level, so we must not
 * touch the values here.
 */
function remapNestedValue(
  value: unknown,
  attr: StoredAttributeMeta,
  recurse: (v: AnyRecord, attrs: StoredAttributeMeta[]) => AnyRecord
): unknown {
  if (!attr.typeRef || value === null || typeof value !== 'object') {
    return value;
  }
  const meta = getDocumentMeta(attr.typeRef());
  if (!meta) {
    return value;
  }
  if (attr.kind === 'nested' && !Array.isArray(value)) {
    return recurse(value as AnyRecord, meta.attributes);
  }
  if (attr.kind === 'array' && Array.isArray(value)) {
    return value.map(elem =>
      elem !== null && typeof elem === 'object' ? recurse(elem as AnyRecord, meta.attributes) : elem
    );
  }
  return value;
}

/**
 * Recursively renames document keys from property name → DynamoDB attribute name,
 * descending into nested documents and arrays of documents.
 */
function aliasKeysToAttribute(value: AnyRecord, attrs: StoredAttributeMeta[]): AnyRecord {
  const out: AnyRecord = {...value};
  for (const attr of attrs) {
    if (!(attr.propertyKey in out)) {
      continue;
    }
    const mapped = remapNestedValue(out[attr.propertyKey], attr, aliasKeysToAttribute);
    if (attr.attributeName !== attr.propertyKey) {
      delete out[attr.propertyKey];
    }
    out[attr.attributeName] = mapped;
  }
  return out;
}

/**
 * Recursively renames document keys from DynamoDB attribute name → property name,
 * descending into nested documents and arrays of documents.
 */
function aliasKeysToProperty(value: AnyRecord, attrs: StoredAttributeMeta[]): AnyRecord {
  const out: AnyRecord = {...value};
  for (const attr of attrs) {
    if (!(attr.attributeName in out)) {
      continue;
    }
    let mapped = remapNestedValue(out[attr.attributeName], attr, aliasKeysToProperty);
    if (isDateKind(attr.kind)) {
      mapped = parseTimestamp(mapped, attr.timestampType);
    }
    if (attr.attributeName !== attr.propertyKey) {
      delete out[attr.attributeName];
    }
    out[attr.propertyKey] = mapped;
  }
  return out;
}

export class InternalModel<T extends object = object> {
  readonly #dModel: ReturnType<typeof dynamoose.model>;
  readonly #schema: ResolvedSchema;
  readonly #entityClass: new () => T;
  #streamPollerPromise: Promise<StreamPoller> | undefined;

  constructor(entityClass: new () => T, schema: ResolvedSchema, dModel: ReturnType<typeof dynamoose.model>) {
    this.#entityClass = entityClass;
    this.#schema = schema;
    this.#dModel = dModel;
  }

  get schema(): ResolvedSchema {
    return this.#schema;
  }
  get raw(): ReturnType<typeof dynamoose.model> {
    return this.#dModel;
  }

  /** Translate property keys → attribute names for a key object, serializing Date fields. */
  toAttributeKey(key: Partial<T>): AnyRecord {
    const out: AnyRecord = {};
    const attrByProp: Record<string, StoredAttributeMeta> = {};
    for (const attr of this.#rootAttrs()) {
      attrByProp[attr.propertyKey] = attr;
    }
    const entries = Object.entries(key as unknown as Record<string, unknown>);
    for (const [k, v] of entries) {
      const attrName = this.#schema.aliasMap[k] ?? k;
      const meta = attrByProp[k];
      const isDateKind =
        meta?.kind === 'date' ||
        meta?.kind === 'createDate' ||
        meta?.kind === 'updateDate' ||
        meta?.kind === 'deleteDate';
      if (isDateKind && v === null) {
        // null deleteDate = not deleted; omit so Dynamoose doesn't validate type
        continue;
      }
      if (isDateKind && v instanceof Date) {
        out[attrName] = serializeDate(v, meta.timestampType as 'iso' | 'epoch' | 'ttl');
      } else if (meta && (meta.kind === 'nested' || meta.kind === 'array')) {
        // Recurse so nested-document aliases are applied at every level.
        out[attrName] = remapNestedValue(v, meta, aliasKeysToAttribute);
      } else {
        out[attrName] = v;
      }
    }
    return out;
  }

  /** Translate attribute names → property keys for a result object, recursing into nested documents. */
  toPropertyObject(raw: AnyRecord): T {
    return aliasKeysToProperty(raw, this.#rootAttrs()) as T;
  }

  #rootAttrs(): StoredAttributeMeta[] {
    return getTableMeta(this.#entityClass as new () => object)?.attributes ?? [];
  }

  /**
   * Injects createdAt + updatedAt (and their equivalents in every nested
   * subdoc / array-of-docs) with the current timestamp.
   * Called on save().
   */
  injectCreateTimestamps(item: AnyRecord): void {
    const now = new Date();
    injectTimestampsDeep(item, this.#rootAttrs(), ['createDate', 'updateDate'], now);
  }

  /**
   * Injects updatedAt (and its equivalents in every nested subdoc / array-of-docs)
   * with the current timestamp.
   * Called on update().
   */
  injectUpdateTimestamp(item: AnyRecord): void {
    injectTimestampsDeep(item, this.#rootAttrs(), ['updateDate'], new Date());
  }

  /**
   * Sets the deletedAt field (root only — soft-delete is a root-level concept).
   */
  injectDeleteTimestamp(item: AnyRecord): void {
    injectTimestampsDeep(item, this.#rootAttrs(), ['deleteDate'], new Date());
  }

  /**
   * Clears the deletedAt field (root only).
   */
  clearDeleteTimestamp(item: AnyRecord): void {
    injectTimestampsDeep(item, this.#rootAttrs(), ['deleteDate'], null);
  }

  hasSoftDelete(): boolean {
    return !!this.#schema.deleteDateKey;
  }

  async runHook(hookName: keyof TableHooks<T>, item: AnyRecord): Promise<void> {
    const meta = getTableMeta(this.#entityClass as new () => object);
    const hooks = (meta?.options as Record<string, unknown>)?.['hooks'] as
      | Record<string, ((i: unknown) => void | Promise<void>) | undefined>
      | undefined;
    const fn = hooks?.[hookName];
    if (typeof fn === 'function') {
      await fn(item);
    }
  }

  normalize(raw: unknown): T {
    if (raw === null || raw === undefined) {
      return {} as T;
    }
    const obj: AnyRecord =
      typeof (raw as Record<string, unknown>)['toJSON'] === 'function'
        ? (raw as {toJSON(): AnyRecord}).toJSON()
        : (raw as unknown as AnyRecord);
    const properties = this.toPropertyObject(obj);
    return Object.assign(new this.#entityClass(), properties);
  }

  /**
   * Returns the shared {@link StreamPoller} for this table, creating it (and enabling the
   * physical table's DynamoDB Stream, if needed) on the first call. Every subsequent call —
   * across every `Repository` instance for this entity — reuses the same poller.
   */
  getStreamPoller(): Promise<StreamPoller> {
    if (!this.#streamPollerPromise) {
      this.#streamPollerPromise = this.#bootstrapStreamPoller();
    }
    return this.#streamPollerPromise;
  }

  async #bootstrapStreamPoller(): Promise<StreamPoller> {
    const viewType = this.#schema.streamViewType!;
    const ddb = dynamoose.aws.ddb();
    const streamArn = await ensureStreamEnabled(
      ddb as unknown as DescribeUpdateTableClient,
      this.#schema.tableName,
      viewType
    );
    const streamsClient = new DynamoDBStreams(ddb.config as never);
    return new StreamPoller(streamsClient as unknown as DynamoDBStreamsLike, streamArn);
  }
}
