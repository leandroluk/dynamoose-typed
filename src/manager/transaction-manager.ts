import type {InternalModel} from '#/model/internal-model';
import {Repository} from '#/repository/repository';
import type {CountOptions, FindOptions, PaginatedResult} from '#/types';
import type {TransactionCollector} from './transaction-collector';

/**
 * A write-intercepting manager used exclusively inside `dataSource.transaction()`.
 *
 * - **Reads** (findOneBy, find, scan, count) execute immediately against DynamoDB.
 * - **Writes** (save, update, delete, hardDelete, restore) are enqueued in the
 *   {@link TransactionCollector} and flushed atomically when the callback resolves.
 *
 * This mirrors how TypeORM's QueryRunner works: you can read inside a transaction
 * to build the writes, but the actual writes are atomic.
 */
export class TransactionManager {
  readonly #registry: Map<new () => unknown, InternalModel<object>>;
  readonly #collector: TransactionCollector;

  /** @internal */
  constructor(registry: Map<new () => unknown, InternalModel<object>>, collector: TransactionCollector) {
    this.#registry = registry;
    this.#collector = collector;
  }

  #getModel<T extends object>(entityClass: new () => T): InternalModel<T> {
    const model = this.#registry.get(entityClass as new () => unknown);
    if (!model) {
      throw new Error(`[dynamoose-typed] "${entityClass.name}" is not registered in this DataSource.`);
    }
    return model as InternalModel<T>;
  }

  async findOneBy<T extends object>(
    entityClass: new () => T,
    key: Partial<T>,
    options?: FindOptions
  ): Promise<T | undefined> {
    return new Repository<T>(this.#getModel(entityClass)).findOneBy(key, options);
  }

  async findOneByOrFail<T extends object>(
    entityClass: new () => T,
    key: Partial<T>,
    options?: FindOptions
  ): Promise<T> {
    return new Repository<T>(this.#getModel(entityClass)).findOneByOrFail(key, options);
  }

  async find<T extends object>(
    entityClass: new () => T,
    hashValue: unknown,
    options?: FindOptions
  ): Promise<PaginatedResult<T>> {
    return new Repository<T>(this.#getModel(entityClass)).find(hashValue, options);
  }

  async scan<T extends object>(entityClass: new () => T, options?: FindOptions): Promise<PaginatedResult<T>> {
    return new Repository<T>(this.#getModel(entityClass)).scan(options);
  }

  async count<T extends object>(entityClass: new () => T, options?: CountOptions): Promise<number> {
    return new Repository<T>(this.#getModel(entityClass)).count(options);
  }

  create<T extends object>(item: Partial<T>, entityClass?: new () => T): T {
    const Cls = entityClass ?? (item.constructor as new () => T);
    this.#getModel(Cls);
    return item as T;
  }

  /**
   * Enqueues a create operation.
   * Hooks and timestamps are injected immediately (before enqueue),
   * but the actual DynamoDB write happens atomically at flush time.
   */
  async save<T extends object>(item: T, entityClass?: new () => T): Promise<T> {
    const Cls = entityClass ?? (item.constructor as new () => T);
    const model = this.#getModel(Cls);
    const raw = model.toAttributeKey(item);
    model.injectCreateTimestamps(raw);
    await model.runHook('beforeInsert', raw);
    this.#collector.enqueueCreate(model, raw);
    return model.normalize(raw);
  }

  async update<T extends object>(entityClass: new () => T, key: Partial<T>, changes: Partial<T>): Promise<void> {
    const model = this.#getModel(entityClass);
    const attrKey = model.toAttributeKey(key);
    const attrChanges = model.toAttributeKey(changes);
    model.injectUpdateTimestamp(attrChanges);
    await model.runHook('beforeUpdate', {...attrKey, ...attrChanges});
    this.#collector.enqueueUpdate(model, attrKey, attrChanges);
  }

  async delete<T extends object>(entityClass: new () => T, key: Partial<T>): Promise<void> {
    const model = this.#getModel(entityClass);
    const attrKey = model.toAttributeKey(key);

    if (model.hasSoftDelete()) {
      const patch: Record<string, unknown> = {...attrKey};
      model.injectDeleteTimestamp(patch);
      await model.runHook('beforeDelete', patch);
      this.#collector.enqueueUpdate(model, attrKey, patch);
    } else {
      await model.runHook('beforeDelete', attrKey);
      this.#collector.enqueueDelete(model, attrKey);
    }
  }

  async hardDelete<T extends object>(entityClass: new () => T, key: Partial<T>): Promise<void> {
    const model = this.#getModel(entityClass);
    const attrKey = model.toAttributeKey(key);
    await model.runHook('beforeDelete', attrKey);
    this.#collector.enqueueDelete(model, attrKey);
  }

  async restore<T extends object>(entityClass: new () => T, key: Partial<T>): Promise<void> {
    const model = this.#getModel(entityClass);
    const attrKey = model.toAttributeKey(key);
    const patch: Record<string, unknown> = {};
    model.clearDeleteTimestamp(patch);
    this.#collector.enqueueUpdate(model, attrKey, patch);
  }
}
