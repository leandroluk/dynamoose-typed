import type {InternalModel} from '#/model/internal-model';
import type {AnyRecord, CountOptions, FindOptions, ItemKey, PaginatedResult} from '#/types';
import {type InputKey} from 'dynamoose/dist/General';

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
   */
  async save(item: T): Promise<T> {
    const raw = this.#model.toAttributeKey(item);
    this.#model.injectCreateTimestamps(raw);
    await this.#model.runHook('beforeInsert', raw);
    await this.#model.raw.create(raw);
    await this.#model.runHook('afterInsert', raw);
    return this.#model.normalize(raw);
  }

  /**
   * Updates an existing item partially.
   */
  async update(key: ItemKey<T>, changes: Partial<T>): Promise<T> {
    const attrKey = this.#model.toAttributeKey(key);
    const attrChanges = this.#model.toAttributeKey(changes);
    this.#model.injectUpdateTimestamp(attrChanges);
    await this.#model.runHook('beforeUpdate', {...attrKey, ...attrChanges});
    const result = await this.#model.raw.update(attrKey, attrChanges);
    const normalized = this.#model.normalize(result);
    await this.#model.runHook('afterUpdate', normalized as AnyRecord);
    return normalized;
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
   * Query all items by hash key value.
   */
  async find(hashValue: unknown, options: FindOptions = {}): Promise<PaginatedResult<T>> {
    const schema = this.#model.schema;
    let q = this.#model.raw.query(schema.hashKey).eq(hashValue as string | number);

    if (options.limit) {
      q = q.limit(options.limit);
    }
    if (options.consistent) {
      q = q.consistent();
    }
    if (options.startAt) {
      q = q.startAt(options.startAt);
    }

    const result = await q.exec();
    let items = result.map(r => this.#model.normalize(r));

    if (!options.withDeleted && this.#model.hasSoftDelete()) {
      const deleteDateKey = this.#model.schema.deleteDateKey!;
      items = items.filter(
        i => (i as AnyRecord)[deleteDateKey] === null || (i as AnyRecord)[deleteDateKey] === undefined
      );
    }

    return {items, count: items.length, lastKey: result.lastKey as AnyRecord | undefined};
  }

  /**
   * Full-table scan.
   */
  async scan(options: FindOptions = {}): Promise<PaginatedResult<T>> {
    let s = this.#model.raw.scan();
    if (options.limit) {
      s = s.limit(options.limit);
    }
    if (options.startAt) {
      s = s.startAt(options.startAt);
    }

    const result = await s.exec();
    let items = result.map(r => this.#model.normalize(r));

    if (!options.withDeleted && this.#model.hasSoftDelete()) {
      const deleteDateKey = this.#model.schema.deleteDateKey!;
      items = items.filter(
        i => (i as AnyRecord)[deleteDateKey] === null || (i as AnyRecord)[deleteDateKey] === undefined
      );
    }

    return {items, count: items.length, lastKey: result.lastKey as AnyRecord | undefined};
  }

  /**
   * Counts items matching the query/scan.
   * Note: This performs a full scan/query and counts in memory.
   * For large tables, consider using DynamoDBExpressions or DynamoDBMapper.
   */
  async count(options: CountOptions = {}): Promise<number> {
    const result = await this.#model.raw.scan().exec();
    let items = result.map(r => this.#model.normalize(r));

    if (!options.withDeleted && this.#model.hasSoftDelete()) {
      const deleteDateKey = this.#model.schema.deleteDateKey!;
      items = items.filter(
        i => (i as AnyRecord)[deleteDateKey] === null || (i as AnyRecord)[deleteDateKey] === undefined
      );
    }

    return items.length;
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
    const attrKey = this.#model.toAttributeKey(key) as unknown as InputKey;
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
    await this.#model.raw.batchPut(raws);
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
}
