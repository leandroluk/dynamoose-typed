import {resolveTableSchema} from '#/schema';
import type {AnyRecord, CountOptions, FindOptions, PaginatedResult} from '#/types';
import {InMemoryRepository} from './in-memory-repository';

/**
 * Drop-in test double for {@link DataSource}.
 * No DynamoDB connection, no AWS credentials needed.
 *
 * @example
 * ```ts
 * // in your test file
 * import { InMemoryDataSource } from 'dynamoose-typed/testing';
 *
 * const ds = new InMemoryDataSource({ entities: [UserTable] });
 *
 * const repo = ds.getRepository(UserTable);
 * await repo.save({ id: '1', name: 'Alice', age: 30 });
 * const user = await repo.findOneBy({ id: '1' });
 * expect(user?.name).toBe('Alice');
 * ```
 */
export class InMemoryDataSource {
  readonly #repos = new Map<new () => unknown, InMemoryRepository<AnyRecord>>();

  constructor(options: {entities: (new () => unknown)[]}) {
    for (const entityClass of options.entities) {
      const schema = resolveTableSchema(entityClass);
      this.#repos.set(entityClass, new InMemoryRepository(schema));
    }
  }

  // ── Repository ─────────────────────────────────────────────────────────────

  getRepository<T extends object>(entityClass: new () => T): InMemoryRepository<T> {
    const repo = this.#repos.get(entityClass as new () => unknown);
    if (!repo) {
      throw new Error(`[in-memory] "${entityClass.name}" is not registered.`);
    }
    return repo as unknown as InMemoryRepository<T>;
  }

  // ── Manager surface (mirrors EntityManager) ────────────────────────────────

  get manager(): InMemoryManager {
    return new InMemoryManager(this.#repos);
  }

  // ── Transaction (runs immediately — no atomicity needed for tests) ─────────

  async transaction<R = void>(callback: (tx: InMemoryManager) => Promise<R>): Promise<R> {
    return callback(this.manager);
  }

  // ── Test helpers ───────────────────────────────────────────────────────────

  /** Clear all repos (call in beforeEach). */
  clear(): void {
    for (const repo of this.#repos.values()) {
      repo.clear();
    }
  }
}

// ─── InMemoryManager ──────────────────────────────────────────────────────────

export class InMemoryManager {
  readonly #repos: Map<new () => unknown, InMemoryRepository<AnyRecord>>;

  constructor(repos: Map<new () => unknown, InMemoryRepository<AnyRecord>>) {
    this.#repos = repos;
  }

  #repo<T extends object>(entityClass: new () => T): InMemoryRepository<T> {
    const repo = this.#repos.get(entityClass as new () => unknown);
    if (!repo) {
      throw new Error(`[in-memory] "${entityClass.name}" is not registered.`);
    }
    return repo as unknown as InMemoryRepository<T>;
  }

  create<T extends object>(item: T, entityClass?: new () => T): T {
    const Cls = entityClass ?? (item.constructor as new () => T);
    return this.#repo(Cls).create(item);
  }

  async save<T extends object>(item: T, entityClass?: new () => T): Promise<T> {
    const Cls = entityClass ?? (item.constructor as new () => T);
    return this.#repo(Cls).save(item);
  }

  async update<T extends object>(entityClass: new () => T, key: Partial<T>, changes: Partial<T>): Promise<T> {
    return this.#repo(entityClass).update(key, changes);
  }

  async findOneBy<T extends object>(
    entityClass: new () => T,
    key: Partial<T>,
    options?: FindOptions
  ): Promise<T | undefined> {
    return this.#repo(entityClass).findOneBy(key, options);
  }

  async findOneByOrFail<T extends object>(
    entityClass: new () => T,
    key: Partial<T>,
    options?: FindOptions
  ): Promise<T> {
    return this.#repo(entityClass).findOneByOrFail(key, options);
  }

  async find<T extends object>(
    entityClass: new () => T,
    hashValue: unknown,
    options?: FindOptions
  ): Promise<PaginatedResult<T>> {
    return this.#repo(entityClass).find(hashValue, options);
  }

  async scan<T extends object>(entityClass: new () => T, options?: FindOptions): Promise<PaginatedResult<T>> {
    return this.#repo(entityClass).scan(options);
  }

  async count<T extends object>(entityClass: new () => T, options?: CountOptions): Promise<number> {
    return this.#repo(entityClass).count(options);
  }

  async delete<T extends object>(entityClass: new () => T, key: Partial<T>): Promise<void> {
    return this.#repo(entityClass).delete(key);
  }

  async hardDelete<T extends object>(entityClass: new () => T, key: Partial<T>): Promise<void> {
    return this.#repo(entityClass).hardDelete(key);
  }

  async restore<T extends object>(entityClass: new () => T, key: Partial<T>): Promise<void> {
    return this.#repo(entityClass).restore(key);
  }

  async batchSave<T extends object>(entityClass: new () => T, items: T[]): Promise<void> {
    return this.#repo(entityClass).batchSave(items);
  }

  async batchDelete<T extends object>(entityClass: new () => T, keys: Partial<T>[]): Promise<void> {
    return this.#repo(entityClass).batchDelete(keys);
  }

  async batchGet<T extends object>(entityClass: new () => T, keys: Partial<T>[]): Promise<(T | undefined)[]> {
    return this.#repo(entityClass).batchGet(keys);
  }
}
