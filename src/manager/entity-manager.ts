import type {InternalModel} from '#/model/internal-model';
import {Repository} from '#/repository/repository';
import type {CountOptions, FindOptions, PaginatedResult} from '#/types';

/**
 * Cross-entity manager.
 * Access via `dataSource.manager` or as the argument of `dataSource.transaction(...)`.
 */
export class EntityManager {
  readonly #registry: Map<new () => unknown, InternalModel<object>>;

  constructor(registry: Map<new () => unknown, InternalModel<object>>) {
    this.#registry = registry;
  }

  /**
   * Get the internal model for an entity class.
   */
  #getModel<T extends object>(entityClass: new () => T): InternalModel<T> {
    const model = this.#registry.get(entityClass as new () => unknown);
    if (!model) {
      throw new Error(`[dynamoose-typed] "${entityClass.name}" is not registered in this DataSource.`);
    }
    return model as InternalModel<T>;
  }

  /**
   * Get the repository for an entity class.
   */
  getRepository<T extends object>(entityClass: new () => T): Repository<T> {
    return new Repository<T>(this.#getModel(entityClass));
  }

  create<T extends object>(entityClass: new () => T, item: Partial<T>): T {
    this.#getModel(entityClass);
    return {...item} as T;
  }

  /**
   * Save an entity.
   */
  async save<T extends object>(item: T, entityClass?: new () => T): Promise<T> {
    const Cls = entityClass ?? (item.constructor as new () => T);
    return this.getRepository(Cls).save(item);
  }

  /**
   * Update an entity.
   */
  async update<T extends object>(entityClass: new () => T, key: Partial<T>, changes: Partial<T>): Promise<T> {
    return this.getRepository(entityClass).update(key, changes);
  }

  /**
   * Find an entity by key.
   */
  async findOneBy<T extends object>(
    entityClass: new () => T,
    key: Partial<T>,
    options?: FindOptions
  ): Promise<T | undefined> {
    return this.getRepository(entityClass).findOneBy(key, options);
  }

  /**
   * Find an entity by key, or throw if not found.
   */
  async findOneByOrFail<T extends object>(
    entityClass: new () => T,
    key: Partial<T>,
    options?: FindOptions
  ): Promise<T> {
    return this.getRepository(entityClass).findOneByOrFail(key, options);
  }

  /**
   * Find entities by hash key.
   */
  async find<T extends object>(
    entityClass: new () => T,
    hashValue: unknown,
    options?: FindOptions
  ): Promise<PaginatedResult<T>> {
    return this.getRepository(entityClass).find(hashValue, options);
  }

  /**
   * Scan entities.
   */
  async scan<T extends object>(entityClass: new () => T, options?: FindOptions): Promise<PaginatedResult<T>> {
    return this.getRepository(entityClass).scan(options);
  }

  /**
   * Count entities.
   */
  async count<T extends object>(entityClass: new () => T, options?: CountOptions): Promise<number> {
    return this.getRepository(entityClass).count(options);
  }

  /**
   * Delete an entity.
   */
  async delete<T extends object>(entityClass: new () => T, key: Partial<T>): Promise<void> {
    return this.getRepository(entityClass).delete(key);
  }

  /**
   * Hard delete an entity.
   */
  async hardDelete<T extends object>(entityClass: new () => T, key: Partial<T>): Promise<void> {
    return this.getRepository(entityClass).hardDelete(key);
  }

  /**
   * Restore an entity.
   */
  async restore<T extends object>(entityClass: new () => T, key: Partial<T>): Promise<void> {
    return this.getRepository(entityClass).restore(key);
  }

  /**
   * Batch save entities.
   */
  async batchSave<T extends object>(entityClass: new () => T, items: T[]): Promise<void> {
    return this.getRepository(entityClass).batchSave(items);
  }

  /**
   * Batch delete entities.
   */
  async batchDelete<T extends object>(entityClass: new () => T, keys: Partial<T>[]): Promise<void> {
    return this.getRepository(entityClass).batchDelete(keys);
  }

  /**
   * Batch get entities.
   */
  async batchGet<T extends object>(entityClass: new () => T, keys: Partial<T>[]): Promise<(T | undefined)[]> {
    return this.getRepository(entityClass).batchGet(keys);
  }
}
