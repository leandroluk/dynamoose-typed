import {EntityManager, TransactionCollector, TransactionManager} from '#/manager';
import {InternalModel} from '#/model/internal-model';
import {Repository} from '#/repository/repository';
import {resolveTableSchema} from '#/schema';
import type {AnyItem, ThroughputOptions} from '#/types';
import dynamoose, {type aws} from 'dynamoose';

type DynamoDB = InstanceType<typeof aws.ddb.DynamoDB>;

type DataSourceOptionsLocal = {
  /**
   * Hostname of the local DynamoDB server. Defaults to `'localhost'`.
   */
  host?: string;

  /**
   * Port of the local DynamoDB server. Defaults to `8000`.
   */
  port?: number;
};

type DataSourceOptionsTable = {
  /**
   * String prepended to every table name.
   * E.g. `'prod_'` transforms `'users'` → `'prod_users'`.
   */
  prefix?: string;

  /**
   * String appended to every table name.
   * E.g. `'_v2'` transforms `'users'` → `'users_v2'`.
   */
  suffix?: string;

  /**
   * Default DynamoDB billing mode applied to all registered entities.
   * Overridden per-entity via `@DynamoTable({ throughput: ... })`.
   *
   * @example
   * table: { throughput: 'ON_DEMAND' }
   */
  throughput?: ThroughputOptions;
};

/**
 * Configuration options required to instantiate and initialize a {@link DataSource}.
 */
export interface DataSourceOptions {
  /**
   * List of decorated entity classes (decorated with `@DynamoTable`) to register with this DataSource.
   */
  entities: (new () => unknown)[];

  /**
   * An optional pre-configured DynamoDB client instance (e.g. from `@aws-sdk/client-dynamodb`).
   * Must be a full `DynamoDB` client (not `DynamoDBClient`), as Dynamoose calls methods
   * like `createTable()` directly on the client.
   * If not specified, Dynamoose will attempt to instantiate a client using default AWS SDK environment variables.
   */
  client?: DynamoDB;

  /**
   * Enables connecting to a local DynamoDB instance (e.g., DynamoDB Local running in Docker or offline).
   * Can be set to `true` to use the default `http://localhost:8000`, or an object specifying host/port configuration.
   */
  local?: boolean | DataSourceOptionsLocal;

  /**
   * Global table name transformations applied to all registered entities at initialization time.
   * Useful for separating environments (prod, staging, dev) within a shared DynamoDB account.
   *
   * @example
   * // @DynamoTable('users') → 'prod_users'
   * table: { prefix: 'prod_' }
   *
   * @example
   * // @DynamoTable('users') → 'prod_users_v2'
   * table: { prefix: 'prod_', suffix: '_v2' }
   */
  table?: DataSourceOptionsTable;
}

/**
 * Central entry-point — mirrors TypeORM's `DataSource`.
 *
 * @example
 * ```ts
 * const dataSource = new DataSource({
 *   entities: [UserTable, OrderTable],
 *   client: new DynamoDBClient({ region: 'us-east-1' }),
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
   * Entity manager.
   */
  #manager: EntityManager | null = null;
  /**
   * Whether the data source is initialized.
   */
  #initialized = false;

  constructor(options: DataSourceOptions) {
    this.#options = options;
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
    this.#setup();
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
      this.#setup();
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
   * Configure client, register entities, wire manager. Idempotent entry point
   * shared by initialize() and the lazy path in getRepository().
   */
  #setup(): void {
    this.#configureClient();
    for (const entityClass of this.#options.entities) {
      this.#register(entityClass);
    }
    this.#manager = new EntityManager(this.#models);
    this.#initialized = true;
  }

  /**
   * Configure the AWS client on the global Dynamoose instance.
   *
   * NOTE: Uses the global Dynamoose instance (not an isolated Instance) because
   * `Schema` and `model` are always global in Dynamoose v4, and Table must share
   * the same instance for DDB calls to resolve correctly.
   */
  #configureClient(): void {
    const {client, local} = this.#options;

    if (local) {
      const host = typeof local === 'object' ? (local.host ?? 'localhost') : 'localhost';
      const port = typeof local === 'object' ? (local.port ?? 8000) : 8000;
      dynamoose.aws.ddb.local(`http://${host}:${port}`);
      return;
    }

    if (client) {
      dynamoose.aws.ddb.set(client);
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
    const prefix = this.#options.table?.prefix ?? '';
    const suffix = this.#options.table?.suffix ?? '';
    const tableName = `${prefix}${resolved.tableName}${suffix}`;

    const perEntityThroughput = resolved.tableOptions['throughput'] as ThroughputOptions | undefined;
    const resolvedThroughput = perEntityThroughput ?? this.#options.table?.throughput;

    const {throughput: _drop, ...baseTableOptions} = resolved.tableOptions as Record<string, unknown> & {
      throughput?: ThroughputOptions;
    };
    const tableOptions = {
      ...baseTableOptions,
      ...(resolvedThroughput !== undefined ? {throughput: resolvedThroughput} : {}),
    };

    // @ts-expect-error - Dynamoose v4 type alignment
    const dSchema = new dynamoose.Schema(resolved.definition, resolved.schemaOptions);
    const dModel = dynamoose.model(tableName, dSchema);

    new dynamoose.Table(tableName, [dModel], tableOptions);

    this.#models.set(
      entityClass as new () => unknown,
      new InternalModel(entityClass as new () => AnyItem, {...resolved, tableName}, dModel)
    );
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
