import {getDocumentMeta, getTableMeta} from '#/decorators/metadata.registry';
import type {ResolvedSchema} from '#/schema';
import {serializeDate} from '#/schema';
import type {AnyRecord, StoredAttributeMeta, TableHooks} from '#/types';
import type * as dynamoose from 'dynamoose';

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
      const type = attr.timestampType ?? Date;
      (item as Record<string, unknown>)[attr.attributeName] =
        value === null ? null : serializeDate(value, type as StringConstructor);
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

export class InternalModel<T extends object = object> {
  readonly #dModel: ReturnType<typeof dynamoose.model>;
  readonly #schema: ResolvedSchema;
  readonly #entityClass: new () => T;

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

  /** Translate property keys → attribute names for a key object. */
  toAttributeKey(key: Partial<T>): AnyRecord {
    const out: AnyRecord = {};
    const entries = Object.entries(key as unknown as Record<string, unknown>);
    for (const [k, v] of entries) {
      out[this.#schema.aliasMap[k] ?? k] = v;
    }
    return out;
  }

  /** Translate attribute names → property keys for a result object. */
  toPropertyObject(raw: AnyRecord): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[this.#schema.reverseAliasMap[k] ?? k] = v;
    }
    return out as T;
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
}
