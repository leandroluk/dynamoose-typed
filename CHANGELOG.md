# Changelog

## [1.9.3] - 2026-07-13

### Added

- **`EntityManager.subscribe()` / `InMemoryManager.subscribe()`** — `dataSource.manager` now exposes `subscribe()`, delegating to the entity's repository, matching every other repository method already mirrored on the manager.

### Changed

- **`repository.subscribe()` callback now receives event metadata** — `callback: (item, meta) => ...` where `meta` is `{ eventId, eventName, approximateCreationDateTime, sequenceNumber }`. `eventId`/`sequenceNumber` come from the DynamoDB Streams record (synthetic values for `InMemoryRepository`); `eventName` lets a single callback subscribed to multiple `eventTypes` tell which change fired.

## [1.9.0] - 2026-07-10

### Docs

- **`@VersionAttribute` / optimistic locking documented in root `README.md`** — the feature (added in 1.1.0) was only documented in the full docs site (`docs/README.md`); the npm package readme now covers it too, with the Features list, a full usage example, and the attribute decorators reference table.

## [1.8.4] - 2026-07-09

### Fixed

- **Date conversion in nested/array documents on read** — Dynamoose does not consistently apply `get` transforms to items inside nested documents or arrays, so timestamp fields (`@DateAttribute`, `@CreateDateAttribute`, `@UpdateDateAttribute`, `@DeleteDateAttribute`) reached Zod validation as raw numbers/strings instead of `Date` instances. `aliasKeysToProperty()` now explicitly converts stored timestamps (epoch, iso, ttl) to `Date` at every nesting level.

## [1.8.3] - 2026-07-09

### Fixed

- **`CreateDateAttribute` / `UpdateDateAttribute` / `DeleteDateAttribute` auto deserialization on read** — these decorators now include automatic `get`/`set` transforms, matching `@DateAttribute`. Previously only the storage `type` (`Number`/`String`) was set, so reading an item back from DynamoDB returned the raw epoch number / ISO string instead of a `Date` instance. User-supplied `get`/`set` options still override the defaults.

## [1.6.3] - 2026-06-02

### Fixed

- **`DateAttribute` auto serialization on save** — `@DateAttribute({ format: 'epoch' })` and `@DateAttribute({ format: 'iso' })` now include automatic `set`/`get` transforms. Passing a `Date` instance when saving no longer throws `"Expected … to be of type number, instead found type object"`. User-supplied `set`/`get` options still override the defaults.
- **`DateAttribute` default factory serialization** — a `default` factory that returns a `Date` object (e.g. `default: () => new Date(Date.now() + ttl)`) is now serialized to the correct storage type (epoch ms / ISO string) before being handed to Dynamoose, matching the behaviour of `@CreateDateAttribute` and `@UpdateDateAttribute`.

## [1.6.2] - 2026-06-02

### Changed

- Internal refactor of schema-builder date handling (version bump only; superseded by 1.6.3 fix).

## [1.5.0] - 2026-05-27

### Added

- **`DynamoDB` re-export** — `DynamoDB` from `@aws-sdk/client-dynamodb` is now re-exported directly from `@leandroluk/dynamoose-typed`. Consumers no longer need to import from `@aws-sdk/client-dynamodb` (or from `dynamoose`) just to construct the client.

## [1.4.0] - 2026-05-27

### Fixed

- **ESM subpath imports** — deep imports from `dynamoose/dist/*` now include the `.js` extension (`Condition.js`, `General.js`, `Item.js`), fixing `Cannot find module` errors in ESM consumer packages.

## [1.3.1] - 2026-05-26

### Fixed

- **`DataSource` global instance alignment** — removed the isolated `new Instance()` that caused `TypeError: instance.aws.ddb(...)[method] is not a function` at table-creation time. `DataSource` now uses the global Dynamoose instance consistently for `Schema`, `model`, `Table`, and `aws.ddb` calls.
- **`DataSourceOptions.client` type** — narrowed from `DynamoDB | DynamoDBClient` to `DynamoDB` only. Dynamoose requires the full `DynamoDB` client (which exposes `createTable` etc. directly), not the low-level `DynamoDBClient`. Update any usages: `new DynamoDB({...})` instead of `new DynamoDBClient({...})`.

## [1.3.0] - 2026-05-23

### Added

- **Throughput configuration** — `@DynamoTable` options now accept `throughput: 'ON_DEMAND' | number | { read, write }` to set the DynamoDB billing mode per table. A global default can also be set via `DataSourceOptions.table.throughput`, which is overridden by per-table settings.
- **Composite GSI support** — the `index` option on attribute decorators now accepts an `IndexOptions` object (`{ name?, rangeKey?, project? }`) in addition to `true`. This enables composite GSIs (GSI with a sort key), custom index names, and projection configuration. `rangeKey` references the TypeScript property name and is resolved to the DynamoDB attribute name automatically.

## [1.2.0] - 2026-05-21

### Added

- **Table name prefix/suffix** — `DataSourceOptions` and `InMemoryDataSource` now accept a `table?: { prefix?: string; suffix?: string }` option. When set, the prefix/suffix is applied to every registered entity's table name at initialization time. Useful for isolating environments (prod, staging, dev) within a shared DynamoDB account. Example: `@DynamoTable('users')` with `table: { prefix: 'prod_' }` resolves to `prod_users`.

## [1.1.0] - 2026-05-21

### Added

- **GSI queries** — `repo.findByIndex(attributeKey, hashValue, options)` queries via a Global Secondary Index. Requires `index: true` on the attribute decorator.
- **Sort key conditions** — `find(hashValue, { sortKey: { between: [...] } })` supports `eq`, `lt`, `lte`, `gt`, `gte`, `between`, `beginsWith` on the range key.
- **Filter expressions** — server-side filtering on `find()`, `scan()`, `findByIndex()` via `options.filter`. Supports all DynamoDB comparison operators.
- **`@TtlAttribute`** — marks a `@NumberAttribute` as the DynamoDB TTL epoch field.
- **`findAll()` / `scanAll()`** — auto-paginating variants that loop until `lastKey` is exhausted.
- **`@VersionAttribute`** — optimistic locking. Stores a version counter; `update()` increments it under a conditional expression and throws `OptimisticLockError` on conflict.
- **Projection expressions** — type-safe `select: { attr: true }` option on all query/scan methods. Return type narrows to `Pick<T, selectedKeys>` via TypeScript generics.
- **Condition expressions on writes** — `save(item, { condition: {...} })` and `update(key, changes, { condition: {...} })` support arbitrary condition expressions using the same `FilterCondition` syntax as filters.
- **`dynamoose-typed/testing` submodule** — `InMemoryDataSource`, `InMemoryManager`, and `InMemoryRepository` now exported as a separate entry point. `InMemoryRepository` has full API parity including `findAll`, `scanAll`, `findByIndex`, projection, and `WriteOptions`.

## [1.0.4] - initial release

### Added

- **Decorator-based schema definition** — `@DynamoTable`, `@StringAttribute`, `@NumberAttribute`, `@BooleanAttribute`, `@DateAttribute`, `@CreateDateAttribute`, `@UpdateDateAttribute`, `@DeleteDateAttribute`, `@NestedAttribute`, `@ArrayAttribute`, `@SetAttribute`, `@Attribute`.
- **TypeORM-like repository pattern** — fully-typed `Repository<T>`, `EntityManager`, and `DataSource`.
- **Automatic timestamps and soft deletes** — automatic timestamp injection and transparent soft-delete (`deleted_at`) lifecycle management.
- **Atomic transactions** — atomic transaction blocks via `dataSource.transaction()`.
- **Batch operations** — batch writes, reads, and deletes via `batchSave`, `batchGet`, and `batchDelete`.
- **In-memory testing** — `InMemoryDataSource` for fast, unit testing without a physical DynamoDB connection.
- **Table hooks** — lifecycle hooks (`beforeInsert`, `afterInsert`, etc.) defined directly on table decorators.
- **Attributes aliasing** — decoupling DynamoDB attribute names from TypeScript property names.
- **Sparse-GSI count optimization** — efficient counting without fetching item bodies when `@DeleteDateAttribute` is indexed.
