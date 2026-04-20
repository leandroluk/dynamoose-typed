import {EntityManager, TransactionCollector, TransactionManager} from '#/manager';
import {InternalModel} from '#/model/internal-model';
import {Repository} from '#/repository/repository';
import {resolveTableSchema} from '#/schema';
import type {AnyItem} from '#/types';
import {type DynamoDB, type DynamoDBClient} from '@aws-sdk/client-dynamodb';
import dynamoose, {Instance} from 'dynamoose';

export interface DataSourceOptions {
  /**
   * List of entity classes to register with this DataSource.
   */
  entities: (new () => unknown)[];
  /**
   * Provide an existing DynamoDBClient (e.g. from @aws-sdk/client-dynamodb).
   * If omitted, Dynamoose uses its default AWS config.
   */
  documentClient?: DynamoDB | DynamoDBClient;
  /**
   * Use DynamoDB Local.
   */
  local?: boolean | {host?: string; port?: number};
}

/**
 * Central entry-point — mirrors TypeORM's `DataSource`.
 *
 * @example
 * ```ts
 * const dataSource = new DataSource({
 *   entities: [UserTable, OrderTable],
 *   documentClient: new DynamoDBClient({ region: 'us-east-1' }),
 * });
 *
 * await dataSource.initialize();
 *
 * // via manager
 * const user = await dataSource.manager.findOneBy(UserTable, { id: '1' });
 * const user = await dataSource.manager.findOneBy(UserTable, { id: '1' }, { withDeleted: true });
 *
 * // via repository
 * const repo = dataSource.getRepository(UserTable);
 * const user = await repo.findOneBy({ id: '1' }, { withDeleted: true });
 *
 * // transaction
 * await dataSource.transaction(async (manager) => {
 *   const u = await manager.findOneByOrFail(UserTable, { id: '1' });
 *   u.name = 'Updated';
 *   await manager.save(u);
 * });
 * ```
 */
export class DataSource {
  /**
   * AWS connection options passed to Dynamoose internally.
   */
  readonly #options: DataSourceOptions;
  /**
   * Internal model registry.
   */
  readonly #models = new Map<new () => unknown, InternalModel<object>>();
  /**
   * Dynamoose instance.
   */
  readonly #instance: InstanceType<typeof Instance>;
  /**
   * Entity manager.
   */
  #manager: EntityManager | null = null;
  /**
   * Whether the data source is initialized.
   */
  #initialized = false;

  constructor(options: DataSourceOptions) {
    this.#options = options;
    this.#instance = new Instance();
  }

  /**
   * Whether the data source is initialized.
   */
  get isInitialized(): boolean {
    return this.#initialized;
  }

  /**
   * Entity manager.
   */
  get manager(): EntityManager {
    this.#assertInitialized();
    return this.#manager!;
  }

  /**
   * Initialize the data source.
   */
  async initialize(): Promise<this> {
    if (this.#initialized) {
      return this;
    }
    this.#configureClient();
    for (const entityClass of this.#options.entities) {
      this.#register(entityClass);
    }
    this.#manager = new EntityManager(this.#models);
    this.#initialized = true;
    return this;
  }

  /**
   * Destroy the data source.
   */
  async destroy(): Promise<void> {
    this.#models.clear();
    this.#manager = null;
    this.#initialized = false;
  }

  /**
   * Returns a typed {@link Repository} for the given entity.
   * Auto-initializes the entity lazily if DataSource is not yet initialized.
   */
  getRepository<T extends object>(entityClass: new () => T): Repository<T> {
    if (!this.#initialized) {
      this.#lazyInit();
    }
    return new Repository<T>(this.#getModel(entityClass));
  }

  /**
   * Executes a callback with a {@link TransactionManager}.
   *
   * - **Reads** inside the callback hit DynamoDB immediately.
   * - **Writes** (save / update / delete / hardDelete / restore) are collected
   *   and flushed atomically via `dynamoose.transaction()` after the callback
   *   resolves successfully.
   * - If the callback throws, no writes are flushed.
   *
   * DynamoDB limits: max 100 items per transaction, same-region only.
   *
   * @example
   * await dataSource.transaction(async (tx) => {
   *   const user = await tx.findOneByOrFail(UserTable, { id: '1' });
   *   user.name = 'Updated';
   *   await tx.save(user);                          // enqueued
   *   await tx.delete(OrderTable, { id: 'o1' });    // enqueued
   * });
   * // ← both writes committed atomically here
   */
  async transaction<R = void>(callback: (tx: TransactionManager) => Promise<R>): Promise<R> {
    this.#assertInitialized();

    const collector = new TransactionCollector();
    const tx = new TransactionManager(this.#models, collector);

    const result = await callback(tx);
    await collector.flush();

    return result;
  }

  /**
   * Configure the AWS client.
   */
  #configureClient(): void {
    const {documentClient, local} = this.#options;

    if (local) {
      const host = typeof local === 'object' ? (local.host ?? 'localhost') : 'localhost';
      const port = typeof local === 'object' ? (local.port ?? 8000) : 8000;
      this.#instance.aws.ddb.local(`http://${host}:${port}`);
      return;
    }

    if (documentClient) {
      this.#instance.aws.ddb.set(documentClient as unknown as DynamoDB);
    }
  }

  /**
   * Register an entity with the data source.
   */
  #register(entityClass: new () => unknown): void {
    if (this.#models.has(entityClass)) {
      return;
    }

    const resolved = resolveTableSchema(entityClass);
    // @ts-expect-error - Dynamoose v4 type alignment
    const dSchema = new dynamoose.Schema(resolved.definition, resolved.schemaOptions);
    const dModel = dynamoose.model(resolved.tableName, dSchema);

    new this.#instance.Table(resolved.tableName, [dModel], resolved.tableOptions);

    this.#models.set(
      entityClass as new () => unknown,
      new InternalModel(entityClass as new () => AnyItem, resolved, dModel)
    );
  }

  /**
   * Lazy initialize the data source.
   */
  #lazyInit(): void {
    this.#configureClient();
    for (const Entity of this.#options.entities) {
      this.#register(Entity);
    }
    this.#manager = new EntityManager(this.#models);
    this.#initialized = true;
  }

  /**
   * Get the internal model for an entity.
   */
  #getModel<T extends object>(entityClass: new () => T): InternalModel<T> {
    const model = this.#models.get(entityClass as new () => unknown);
    if (!model) {
      throw new Error(`[dynamoose-typed] "${entityClass.name}" is not registered.`);
    }
    return model as InternalModel<T>;
  }

  /**
   * Assert that the data source is initialized.
   */
  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new Error('[dynamoose-typed] DataSource not initialized. Call dataSource.initialize() first.');
    }
  }
}
