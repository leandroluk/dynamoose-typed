import {OptimisticLockError} from '#/errors';
import type {InternalModel} from '#/model/internal-model';
import type {StreamPoller} from '#/streams/stream-poller';
import {retryWithBackoff} from '#/utils/retry';
import type {
  AnyRecord,
  CountOptions,
  FilterCondition,
  FindOptions,
  ItemKey,
  PaginatedResult,
  Projected,
  SelectMap,
  SubscribeParams,
  Subscription,
  WriteOptions,
} from '#/types';
import type * as DynamoDB from '@aws-sdk/client-dynamodb';
import {Condition} from 'dynamoose/dist/Condition.js';
import {type InputKey} from 'dynamoose/dist/General.js';
import {type ItemSaveSettings} from 'dynamoose/dist/Item.js';

interface ModelUpdateSettings {
  return?: 'item' | 'request';
  condition?: Condition;
  returnValues?: DynamoDB.ReturnValue;
}

function buildCondition(
  filter: Record<string, FilterCondition>,
  aliasMap: Record<string, string>,
  base?: Condition
): Condition {
  const c = base ?? new Condition();
  for (const [propKey, cond] of Object.entries(filter)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = c.where(aliasMap[propKey]!) as any;
    if (cond.eq !== undefined) {
      w.eq(cond.eq);
    } else if (cond.ne !== undefined) {
      w.ne(cond.ne);
    } else if (cond.lt !== undefined) {
      w.lt(cond.lt);
    } else if (cond.lte !== undefined) {
      w.le(cond.lte);
    } else if (cond.gt !== undefined) {
      w.gt(cond.gt);
    } else if (cond.gte !== undefined) {
      w.ge(cond.gte);
    } else if (cond.between !== undefined) {
      w.between(cond.between[0], cond.between[1]);
    } else if (cond.beginsWith !== undefined) {
      w.beginsWith(cond.beginsWith);
    } else if (cond.contains !== undefined) {
      w.contains(cond.contains);
    } else if (cond.exists === true) {
      w.exists();
    } else if (cond.exists === false) {
      w.not().exists();
    } else if (cond.in !== undefined) {
      w.in(cond.in);
    }
  }
  return c;
}

function projectItem<T>(item: T, select: SelectMap<T> | undefined): unknown {
  if (!select) {
    return item;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(select as unknown as Record<string, unknown>)) {
    result[key] = (item as Record<string, unknown>)[key];
  }
  return result;
}

function applyFilters<Q>(q: Q, filter: Record<string, FilterCondition>, aliasMap: Record<string, string>): Q {
  for (const [propKey, cond] of Object.entries(filter)) {
    const attrName = aliasMap[propKey] ?? propKey;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f: any = (q as any).filter(attrName);
    if (cond.eq !== undefined) {
      q = f.eq(cond.eq);
    } else if (cond.ne !== undefined) {
      q = f.ne(cond.ne);
    } else if (cond.lt !== undefined) {
      q = f.lt(cond.lt);
    } else if (cond.lte !== undefined) {
      q = f.lte(cond.lte);
    } else if (cond.gt !== undefined) {
      q = f.gt(cond.gt);
    } else if (cond.gte !== undefined) {
      q = f.gte(cond.gte);
    } else if (cond.between !== undefined) {
      q = f.between(cond.between[0], cond.between[1]);
    } else if (cond.beginsWith !== undefined) {
      q = f.beginsWith(cond.beginsWith);
    } else if (cond.contains !== undefined) {
      q = f.contains(cond.contains);
    } else if (cond.exists === true) {
      q = f.exists();
    } else if (cond.exists === false) {
      q = f.not().exists();
    } else if (cond.in !== undefined) {
      q = f.in(cond.in);
    }
  }
  return q;
}

/**
 * Typed repository for a single entity.
 * Obtain via `dataSource.getRepository(entityClass)`.
 */
export class Repository<T extends object> {
  readonly #model: InternalModel<T>;

  /** @internal */
  constructor(model: InternalModel<T>) {
    this.#model = model;
  }

  /**
   * Instantiates an entity object (no persistence).
   * Equivalent to TypeORM's `repo.create(data)`.
   */
  create(data: Partial<T>): T {
    return {...data} as T;
  }

  /**
   * Persists a new item. Runs beforeInsert/afterInsert hooks and injects timestamps.
   * For versioned entities, enforces insert-only semantics (throws if item already exists).
   */
  async save(item: T, options?: WriteOptions): Promise<T> {
    const raw = this.#model.toAttributeKey(item);
    this.#model.injectCreateTimestamps(raw);
    await this.#model.runHook('beforeInsert', raw);
    const schema = this.#model.schema;
    let settings: ItemSaveSettings | undefined;
    if (schema.versionKey || options?.condition) {
      settings = {
        ...(schema.versionKey ? {overwrite: false} : {}),
        ...(options?.condition ? {condition: buildCondition(options.condition, schema.aliasMap)} : {}),
      } as ItemSaveSettings;
    }
    await this.#model.raw.create(raw, settings as ItemSaveSettings);
    await this.#model.runHook('afterInsert', raw);
    return this.#model.normalize(raw);
  }

  /**
   * Updates an existing item partially.
   * For versioned entities: if `changes` includes the version field, applies an optimistic-lock
   * condition (`version = expected`) and auto-increments the version. Throws `OptimisticLockError`
   * on conflict.
   */
  async update(key: ItemKey<T>, changes: Partial<T>, options?: WriteOptions): Promise<T> {
    const attrKey = this.#model.toAttributeKey(key);
    const attrChanges = this.#model.toAttributeKey(changes);
    this.#model.injectUpdateTimestamp(attrChanges);

    const {versionKey, versionAttrName, aliasMap} = this.#model.schema;
    let updateSettings: {condition?: Condition} | undefined;

    if (versionKey && versionAttrName) {
      const expectedVersion = attrChanges[versionAttrName];
      if (expectedVersion !== undefined && expectedVersion !== null) {
        updateSettings = {
          condition: new Condition().where(versionAttrName).eq(expectedVersion),
        };
        attrChanges[versionAttrName] = (expectedVersion as number) + 1;
      }
    }

    if (options?.condition) {
      updateSettings = {
        ...updateSettings,
        condition: buildCondition(options.condition, aliasMap, updateSettings?.condition),
      };
    }

    await this.#model.runHook('beforeUpdate', {...attrKey, ...attrChanges});
    try {
      const result = await this.#model.raw.update(attrKey, attrChanges, updateSettings as ModelUpdateSettings);
      const normalized = this.#model.normalize(result);
      await this.#model.runHook('afterUpdate', normalized as AnyRecord);
      return normalized;
    } catch (err) {
      if ((err as {name?: string}).name === 'ConditionalCheckFailedException') {
        throw new OptimisticLockError(key);
      }
      throw err;
    }
  }

  /**
   * Find one item by key.
   */
  async findOneBy(key: ItemKey<T>, options: FindOptions = {}): Promise<T | undefined> {
    const attrKey = this.#model.toAttributeKey(key) as unknown as InputKey;
    const result = await this.#model.raw.get(attrKey);
    if (!result) {
      return undefined;
    }
    const item = this.#model.normalize(result);
    if (!options.withDeleted && this.#model.hasSoftDelete()) {
      const deleteDateKey = this.#model.schema.deleteDateKey!;
      if ((item as AnyRecord)[deleteDateKey] !== null && (item as AnyRecord)[deleteDateKey] !== undefined) {
        return undefined;
      }
    }
    return item;
  }

  /**
   * Find one item by key; throws if not found or soft-deleted.
   */
  async findOneByOrFail(key: ItemKey<T>, options: FindOptions = {}): Promise<T> {
    const result = await this.findOneBy(key, options);
    if (result === undefined) {
      throw new Error(`[dynamoose-typed] Entity not found for key: ${JSON.stringify(key)}`);
    }
    return result;
  }

  /**
   * Query items via a GSI. The index name is derived as `${attributeName}GlobalIndex`.
   * Requires `index: true` on the corresponding attribute decorator.
   */
  async findByIndex<S extends SelectMap<T> | undefined = undefined>(
    attributeKey: keyof T & string,
    hashValue: unknown,
    options: FindOptions & {select?: S} = {}
  ): Promise<PaginatedResult<Projected<T, S>>> {
    const schema = this.#model.schema;
    const attrName = schema.aliasMap[attributeKey] ?? attributeKey;
    const indexName = `${attrName}GlobalIndex`;

    let q = this.#model.raw
      .query(attrName)
      .eq(hashValue as string | number)
      .using(indexName);

    if (options.filter) {
      q = applyFilters(q, options.filter, schema.aliasMap);
    }
    if (options.limit) {
      q = q.limit(options.limit);
    }
    if (options.consistent) {
      q = q.consistent();
    }
    if (options.startAt) {
      q = q.startAt(options.startAt);
    }

    const {select} = options;
    const softDelete = !options.withDeleted && this.#model.hasSoftDelete();

    if (select) {
      const attrNames = Object.keys(select).map(k => schema.aliasMap[k]);
      if (softDelete) {
        const deleteDateAttr = schema.aliasMap[schema.deleteDateKey!];
        if (!attrNames.includes(deleteDateAttr)) {
          attrNames.push(deleteDateAttr);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      q = (q as any).attributes(attrNames);
    }

    const result = await q.exec();
    let items = result.map((r: unknown) => this.#model.normalize(r));

    if (softDelete) {
      const deleteDateKey = schema.deleteDateKey!;
      items = items.filter(
        i => (i as AnyRecord)[deleteDateKey] === null || (i as AnyRecord)[deleteDateKey] === undefined
      );
    }

    const projected = items.map(i => projectItem(i, select)) as Projected<T, S>[];
    return {items: projected, count: projected.length, lastKey: result.lastKey as AnyRecord | undefined};
  }

  /**
   * Query all items by hash key value.
   */
  async find<S extends SelectMap<T> | undefined = undefined>(
    hashValue: unknown,
    options: FindOptions & {select?: S} = {}
  ): Promise<PaginatedResult<Projected<T, S>>> {
    const schema = this.#model.schema;
    let q = this.#model.raw.query(schema.hashKey).eq(hashValue as string | number);

    if (options.sortKey && schema.rangeKey) {
      const sk = options.sortKey;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cond: any = (q as any).where(schema.rangeKey);
      if (sk.between !== undefined) {
        q = cond.between(sk.between[0], sk.between[1]);
      } else if (sk.beginsWith !== undefined) {
        q = cond.beginsWith(sk.beginsWith);
      } else if (sk.eq !== undefined) {
        q = cond.eq(sk.eq);
      } else if (sk.lt !== undefined) {
        q = cond.lt(sk.lt);
      } else if (sk.lte !== undefined) {
        q = cond.lte(sk.lte);
      } else if (sk.gt !== undefined) {
        q = cond.gt(sk.gt);
      } else if (sk.gte !== undefined) {
        q = cond.gte(sk.gte);
      }
    }

    if (options.filter) {
      q = applyFilters(q, options.filter, schema.aliasMap);
    }
    if (options.limit) {
      q = q.limit(options.limit);
    }
    if (options.consistent) {
      q = q.consistent();
    }
    if (options.startAt) {
      q = q.startAt(options.startAt);
    }

    const {select} = options;
    const softDelete = !options.withDeleted && this.#model.hasSoftDelete();

    if (select) {
      const attrNames = Object.keys(select).map(k => schema.aliasMap[k]);
      if (softDelete) {
        const deleteDateAttr = schema.aliasMap[schema.deleteDateKey!];
        if (!attrNames.includes(deleteDateAttr)) {
          attrNames.push(deleteDateAttr);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      q = (q as any).attributes(attrNames);
    }

    const result = await q.exec();
    let items = result.map((r: unknown) => this.#model.normalize(r));

    if (softDelete) {
      const deleteDateKey = schema.deleteDateKey!;
      items = items.filter(
        i => (i as AnyRecord)[deleteDateKey] === null || (i as AnyRecord)[deleteDateKey] === undefined
      );
    }

    const projected = items.map(i => projectItem(i, select)) as Projected<T, S>[];
    return {items: projected, count: projected.length, lastKey: result.lastKey as AnyRecord | undefined};
  }

  /**
   * Auto-paginate find() until all pages are exhausted. Returns all matching items.
   */
  async findAll<S extends SelectMap<T> | undefined = undefined>(
    hashValue: unknown,
    options: Omit<FindOptions, 'startAt'> & {select?: S} = {}
  ): Promise<Projected<T, S>[]> {
    const items: Projected<T, S>[] = [];
    let lastKey: AnyRecord | undefined;
    do {
      const page = await this.find(hashValue, {...options, startAt: lastKey} as FindOptions & {select?: S});
      items.push(...page.items);
      lastKey = page.lastKey;
    } while (lastKey);
    return items;
  }

  /**
   * Auto-paginate scan() until all pages are exhausted. Returns all matching items.
   */
  async scanAll<S extends SelectMap<T> | undefined = undefined>(
    options: Omit<FindOptions, 'startAt'> & {select?: S} = {}
  ): Promise<Projected<T, S>[]> {
    const items: Projected<T, S>[] = [];
    let lastKey: AnyRecord | undefined;
    do {
      const page = await this.scan({...options, startAt: lastKey} as FindOptions & {select?: S});
      items.push(...page.items);
      lastKey = page.lastKey;
    } while (lastKey);
    return items;
  }

  /**
   * Full-table scan.
   */
  async scan<S extends SelectMap<T> | undefined = undefined>(
    options: FindOptions & {select?: S} = {}
  ): Promise<PaginatedResult<Projected<T, S>>> {
    const schema = this.#model.schema;
    let s = this.#model.raw.scan();
    if (options.filter) {
      s = applyFilters(s, options.filter, schema.aliasMap);
    }
    if (options.limit) {
      s = s.limit(options.limit);
    }
    if (options.startAt) {
      s = s.startAt(options.startAt);
    }

    const {select} = options;
    const softDelete = !options.withDeleted && this.#model.hasSoftDelete();

    if (select) {
      const attrNames = Object.keys(select).map(k => schema.aliasMap[k]);
      if (softDelete) {
        const deleteDateAttr = schema.aliasMap[schema.deleteDateKey!];
        if (!attrNames.includes(deleteDateAttr)) {
          attrNames.push(deleteDateAttr);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s = (s as any).attributes(attrNames);
    }

    const result = await s.exec();
    let items = result.map((r: unknown) => this.#model.normalize(r));

    if (softDelete) {
      const deleteDateKey = schema.deleteDateKey!;
      items = items.filter(
        i => (i as AnyRecord)[deleteDateKey] === null || (i as AnyRecord)[deleteDateKey] === undefined
      );
    }

    const projected = items.map(i => projectItem(i, select)) as Projected<T, S>[];
    return {items: projected, count: projected.length, lastKey: result.lastKey as AnyRecord | undefined};
  }

  /**
   * Counts items via a full-table scan.
   *
   * When `withDeleted` is true (or the table has no soft-delete), uses DynamoDB
   * `Select: COUNT` — no item bodies are returned, significantly cheaper for
   * large tables.
   *
   * When a sparse GSI is configured on the @DeleteDateAttribute (`index: true`),
   * uses two `Select: COUNT` scans: total minus GSI count (only soft-deleted
   * items appear in the sparse index). Still no item bodies.
   *
   * Falls back to a full scan + client-side filter when no GSI is available,
   * because `restore()` stores `deleted_at = NULL` (DynamoDB NULL type) rather
   * than removing the attribute — `attribute_not_exists` alone would miss
   * restored items.
   */
  async count(options: CountOptions = {}): Promise<number> {
    type CountResult = {exec(): Promise<{count: number}>};

    if (options.withDeleted || !this.#model.hasSoftDelete()) {
      const result = await (this.#model.raw.scan().count() as unknown as CountResult).exec();
      return result.count;
    }

    const {deleteDateIndexName} = this.#model.schema;
    if (deleteDateIndexName) {
      const totalScan = this.#model.raw.scan().count() as unknown as CountResult;
      const gsiScan = (this.#model.raw.scan() as unknown as {using(n: string): {count(): CountResult}})
        .using(deleteDateIndexName)
        .count();
      const [total, deleted] = await Promise.all([totalScan.exec(), gsiScan.exec()]);
      return total.count - deleted.count;
    }

    const result = await this.#model.raw.scan().exec();
    const attrName = this.#model.schema.aliasMap[this.#model.schema.deleteDateKey!]!;
    return result.filter((r: unknown) => {
      const v = (r as AnyRecord)[attrName];
      return v === null || v === undefined;
    }).length;
  }

  /**
   * Soft delete — sets the @DeleteDateAttribute field to now.
   * Falls back to hard delete if the entity has no @DeleteDateAttribute.
   */
  async delete(key: ItemKey<T>): Promise<void> {
    if (!this.#model.hasSoftDelete()) {
      return this.hardDelete(key);
    }
    const item = await this.findOneByOrFail(key);
    const raw = this.#model.toAttributeKey(item);
    this.#model.injectDeleteTimestamp(raw);
    await this.#model.runHook('beforeDelete', raw);
    await this.#model.raw.update(this.#model.toAttributeKey(key), raw);
    await this.#model.runHook('afterDelete', raw);
  }

  /**
   * Hard delete — permanently removes the item from DynamoDB.
   */
  async hardDelete(key: ItemKey<T>): Promise<void> {
    const attrKey = this.#model.toAttributeKey(key) as unknown as InputKey;
    const item = await this.#model.raw.get(attrKey);
    if (item) {
      await this.#model.runHook('beforeDelete', this.#model.normalize(item) as AnyRecord);
      await this.#model.raw.delete(attrKey);
      await this.#model.runHook('afterDelete', this.#model.normalize(item) as AnyRecord);
    }
  }

  /**
   * Restores a soft-deleted item by clearing its @DeleteDateAttribute.
   */
  async restore(key: ItemKey<T>): Promise<void> {
    const attrKey = this.#model.toAttributeKey(key) as unknown as object;
    const patch: AnyRecord = {};
    this.#model.clearDeleteTimestamp(patch);
    await this.#model.raw.update(attrKey, patch);
  }

  /**
   * Saves multiple items in a single batch operation.
   */
  async batchSave(items: T[]): Promise<void> {
    const raws = items.map(item => {
      const raw = this.#model.toAttributeKey(item);
      this.#model.injectCreateTimestamps(raw);
      return raw;
    });
    for (const raw of raws) {
      await this.#model.runHook('beforeInsert', raw);
    }
    await this.#model.raw.batchPut(raws);
    for (const raw of raws) {
      await this.#model.runHook('afterInsert', raw);
    }
  }

  /**
   * Deletes multiple items in a single batch operation.
   */
  async batchDelete(keys: ItemKey<T>[]): Promise<void> {
    await this.#model.raw.batchDelete(keys.map(key => this.#model.toAttributeKey(key)) as unknown as InputKey[]);
  }

  /**
   * Retrieves multiple items in a single batch operation.
   */
  async batchGet(keys: ItemKey<T>[]): Promise<(T | undefined)[]> {
    const attrKeys = keys.map(key => this.#model.toAttributeKey(key)) as unknown as InputKey[];
    const results = (await this.#model.raw.batchGet(attrKeys)) as unknown as Record<string, unknown>[];
    return keys.map(key => {
      const hashKey = this.#model.schema.hashKey;
      const keyVal = (this.#model.toAttributeKey(key) as Record<string, unknown>)[hashKey];
      const match = results.find(r => r[hashKey] === keyVal);
      return match ? this.#model.normalize(match) : undefined;
    });
  }

  /**
   * Subscribes to live DynamoDB Streams change events for this table.
   * Requires `stream` to be set on the entity's `@DynamoTable` decorator.
   *
   * The underlying stream is enabled/polled lazily and shared across every `subscribe()`
   * call for this entity — see {@link InternalModel.getStreamPoller}.
   */
  subscribe(params: SubscribeParams<T>): Subscription {
    const {eventTypes, callback, options} = params;
    const schema = this.#model.schema;
    if (!schema.streamViewType) {
      throw new Error(
        `[dynamoose-typed] "${schema.tableName}" has no stream configured. Add { stream: true } to @DynamoTable.`
      );
    }

    const onError = options?.onError ?? ((err: unknown): void => console.error('[dynamoose-typed] stream error:', err));
    let unsubscribe: (() => void) | undefined;
    let closed = false;

    const attach = (poller: StreamPoller): void => {
      unsubscribe = poller.addListener({
        eventTypes,
        onEvent: async (event): Promise<void> =>
          callback(this.#model.normalize(event.image), {
            eventId: event.eventId,
            eventName: event.eventName,
            approximateCreationDateTime: event.approximateCreationDateTime,
            sequenceNumber: event.sequenceNumber,
            oldItem: event.oldImage
              ? (this.#model.normalize(event.oldImage) as unknown as Record<string, unknown>)
              : undefined,
          }),
        onError,
      });
    };

    const bootstrap = async (): Promise<void> => {
      const poller = await this.#model.getStreamPoller();
      if (!closed) {
        attach(poller);
      }
    };

    if (options?.retry) {
      void retryWithBackoff(bootstrap, {
        ...options.retry,
        shouldRetry: err => (err as {name?: string}).name === 'ResourceNotFoundException',
      }).catch(err => onError(err));
    } else {
      void bootstrap().catch(err => onError(err));
    }

    return {
      close: async (): Promise<void> => {
        closed = true;
        unsubscribe?.();
      },
    };
  }
}
