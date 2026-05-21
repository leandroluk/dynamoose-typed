<div align="center">
  <img src="assets/banner.png" alt="Dynamoose Typed" />
</div>
<br>

<div align="center">
  <a href="https://www.npmjs.com/package/@leandroluk/dynamoose-typed">
    <img src="https://img.shields.io/npm/v/@leandroluk/dynamoose-typed.svg" alt="NPM Version" />
  </a>
  <a href="https://github.com/leandroluk/dynamoose-typed/blob/master/LICENSE">
    <img src="https://img.shields.io/npm/l/@leandroluk/dynamoose-typed.svg" alt="License" />
  </a>
  <a href="https://www.npmjs.com/package/@leandroluk/dynamoose-typed">
    <img src="https://img.shields.io/npm/dw/@leandroluk/dynamoose-typed.svg" alt="Downloads" />
  </a>
  <a href="https://github.com/leandroluk/dynamoose-typed/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/leandroluk/dynamoose-typed/ci.yml?branch=master" alt="CI Status" />
  </a>
  <img src="https://img.shields.io/badge/coverage-100%25-brightgreen.svg" alt="Coverage 100%" />
  <a href="https://buymeacoffee.com/leandroluk">
    <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=flat&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee" />
  </a>
</div>

<br>

A strongly-typed, decorator-driven wrapper around [Dynamoose v4](https://dynamoosejs.com/) — the DynamoDB ODM for Node.js.

## Why this exists

Dynamoose is a great library, but its TypeScript story is painfully lacking. The return types of `model()` are overloaded to the point where nothing is inferred correctly, every operation resolves to `any`, and the schema definition is a plain object with no type-safety. You end up fighting the type system instead of relying on it.

`dynamoose-typed` wraps Dynamoose behind a fully-typed API that mirrors [TypeORM](https://typeorm.io/)'s `DataSource` / `Repository` / `EntityManager` pattern. Define your tables as decorated classes, let the library wire up the schema, and get proper types everywhere.

## Features

- Decorator-based schema definition (`@DynamoTable`, `@StringAttribute`, `@NestedAttribute`, …)
- Typed `Repository<T>` and `EntityManager` for all CRUD operations
- Automatic `created_at` / `updated_at` / soft-delete (`deleted_at`) timestamps
- GSI support via `index: true` on any attribute decorator
- `count()` sparse-GSI optimization — two `Select: COUNT` scans instead of fetching item bodies
- Atomic transactions via `dataSource.transaction()`
- Batch operations (`batchSave`, `batchGet`, `batchDelete`)
- Auto-pagination via `findAll()` and `scanAll()`
- Projection expressions — `select: { id: true, name: true }` narrows the return type at compile time
- Optimistic locking via `@VersionAttribute` — prevents write conflicts with automatic condition checks
- TTL support via `@DateAttribute({ ttl: true })` — stores epoch seconds and propagates to DynamoDB's `timeToLive`
- `InMemoryDataSource` for fast, zero-infrastructure unit tests
- 100% statement / branch / function coverage

## Requirements

- Node.js ≥ 22
- TypeScript with `experimentalDecorators: true` and `emitDecoratorMetadata: true`

## Get started

```bash
pnpm add dynamoose-typed dynamoose @aws-sdk/client-dynamodb
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true
  }
}
```

## Defining a table

```typescript
import { DynamoTable, StringAttribute, NumberAttribute, CreateDateAttribute, UpdateDateAttribute, DeleteDateAttribute } from 'dynamoose-typed';
import crypto from 'node:crypto';

@DynamoTable('users', {
  hooks: {
    beforeInsert: (item) => console.log('inserting', item),
  },
})
class UserTable {
  @StringAttribute({ hashKey: true, default: crypto.randomUUID })
  id!: string;

  @StringAttribute({ required: true })
  name!: string;

  @NumberAttribute({ default: 0 })
  age!: number;

  @CreateDateAttribute('created_at')
  createdAt!: Date;

  @UpdateDateAttribute('updated_at')
  updatedAt!: Date;

  @DeleteDateAttribute('deleted_at')
  deletedAt!: Date | null;
}
```

## Nested documents

```typescript
import { DynamoDocument, StringAttribute, NestedAttribute } from 'dynamoose-typed';
import crypto from 'node:crypto';

@DynamoDocument()
class AddressDocument {
  @StringAttribute({ required: true })
  street!: string;

  @StringAttribute({ required: true })
  city!: string;
}

@DynamoTable('orders')
class OrderTable {
  @StringAttribute({ hashKey: true, default: crypto.randomUUID })
  id!: string;

  @NestedAttribute(() => AddressDocument)
  address!: AddressDocument;

  @ArrayAttribute(() => String, { default: () => [] })
  tags!: string[];

  @SetAttribute(() => String)
  roles!: Set<string>;
}
```

## DataSource

```typescript
import { DataSource } from 'dynamoose-typed';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const dataSource = new DataSource({
  entities: [UserTable, OrderTable],
  documentClient: new DynamoDBClient({ region: 'us-east-1' }),
});

await dataSource.initialize();
```

For DynamoDB Local:

```typescript
const dataSource = new DataSource({
  entities: [UserTable],
  local: { host: 'localhost', port: 8000 },
});
await dataSource.initialize();
```

## Repository

```typescript
const userRepository = dataSource.getRepository(UserTable);

// create (no persistence)
const newUser = userRepository.create({ name: 'Alice', age: 30 });

// save
const savedUser = await userRepository.save(newUser);

// find by key
const foundUser = await userRepository.findOneBy({ id: savedUser.id });

// find by key — throws if not found or soft-deleted
const user = await userRepository.findOneByOrFail({ id: '123' });

// include soft-deleted items
const deletedUser = await userRepository.findOneBy({ id: '123' }, { withDeleted: true });

// query by hash key
const { items, count, lastKey } = await userRepository.find('alice-partition', {
  limit: 20,
  consistent: true,
  startAt: lastKey,
});

// query by hash key + sort key condition (requires rangeKey on table)
const { items: recent } = await userRepository.find('user-1', {
  sortKey: { between: ['2024-01', '2024-12'] },
});
const { items: after } = await userRepository.find('user-1', {
  sortKey: { beginsWith: '2024-' },
});

// server-side filter expressions (AND'd; property keys are alias-aware)
const { items: adults } = await userRepository.find('partition-key', {
  filter: {
    age: { gte: 18 },
    name: { beginsWith: 'Al' },
  },
});

// available filter operators:
// eq, ne, lt, lte, gt, gte         — equality / comparison
// between: [lo, hi]                — range (inclusive)
// beginsWith: 'prefix'             — string prefix
// contains: 'substr'               — substring / set membership
// exists: true | false             — attribute presence
// in: [v1, v2, v3]                 — value set

// filters also work in scan() and findByIndex()
const { items: active } = await userRepository.scan({
  filter: { isActive: { eq: true } },
});

// full-table scan
const { items: allUsers } = await userRepository.scan({ withDeleted: false });

// query by GSI (requires index: true on the attribute)
const { items: byEmail } = await userRepository.findByIndex('email', 'alice@example.com');

// auto-paginate find() until lastKey is exhausted
const allItems = await userRepository.findAll('alice-partition');
const allWithFilter = await userRepository.findAll('alice-partition', {
  filter: { age: { gte: 18 } },
});

// auto-paginate scan() until lastKey is exhausted
const everything = await userRepository.scanAll();

// projection — select only specific attributes (reduces DynamoDB read cost)
// return type is automatically narrowed by TypeScript
const { items: slim } = await userRepository.find('alice-partition', {
  select: { id: true, name: true },
});
// slim: Pick<UserTable, 'id' | 'name'>[]

const { items: ids } = await userRepository.scan({ select: { id: true } });
// ids: Pick<UserTable, 'id'>[]

const { items: byEmail } = await userRepository.findByIndex('email', 'alice@example.com', {
  select: { id: true, name: true },
});

// findAll / scanAll also support select
const names = await userRepository.findAll('alice-partition', { select: { id: true, name: true } });
// names: Pick<UserTable, 'id' | 'name'>[]

// count
const total = await userRepository.count();

// soft-delete (sets deleted_at) — falls back to hardDelete if no @DeleteDateAttribute
await userRepository.delete({ id: savedUser.id });

// hard delete
await userRepository.hardDelete({ id: savedUser.id });

// restore soft-deleted item
await userRepository.restore({ id: savedUser.id });

// batch operations
await userRepository.batchSave([user1, user2, user3]);
await userRepository.batchDelete([{ id: '1' }, { id: '2' }]);
const users = await userRepository.batchGet([{ id: '1' }, { id: '2' }]);
```

## EntityManager

Access via `dataSource.manager` to work with multiple entities without creating a repo for each:

```typescript
const manager = dataSource.manager;

const user = await manager.findOneByOrFail(UserTable, { id: '1' });
const order = await manager.findOneByOrFail(OrderTable, { id: 'o1' });

await manager.save(user);
await manager.delete(OrderTable, { id: 'o1' });
```

## Transactions

Reads inside the callback execute immediately. Writes are collected and flushed atomically via `dynamoose.transaction()` when the callback resolves. If the callback throws, no writes are flushed.

```typescript
await dataSource.transaction(async (tx) => {
  const user = await tx.findOneByOrFail(UserTable, { id: '1' });
  user.name = 'Updated';
  await tx.save(user);                       // enqueued

  await tx.delete(OrderTable, { id: 'o1' }); // enqueued
});
// both writes committed atomically here
```

> DynamoDB limits: max 100 items per transaction, same-region only.

## Condition expressions on writes

Pass a `condition` in `WriteOptions` to `save()` or `update()` to add a server-side guard. If the condition is not met, DynamoDB throws `ConditionalCheckFailedException`. Keys are TypeScript property names (alias-aware); multiple entries are AND'd.

```typescript
import { WriteOptions } from 'dynamoose-typed';

// put only-if-not-exists (id attribute must not exist in the table)
await repo.save(newItem, {
  condition: { id: { exists: false } },
});

// update only-if-status-is-pending
await repo.update({ id: '1' }, { status: 'processing' }, {
  condition: { status: { eq: 'pending' } },
});

// update only-if-price-below-threshold
await repo.update({ id: '1' }, { price: 99 }, {
  condition: { price: { lt: 100 } },
});
```

Supported operators: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `between`, `beginsWith`, `contains`, `exists`, `in`.

When used together with `@VersionAttribute`, both conditions are AND'd automatically:

```typescript
// version lock AND business-rule condition
await repo.update({ id: '1' }, { status: 'done', version: 2 }, {
  condition: { assignee: { eq: 'alice' } },
});
// succeeds only if version == 2 AND assignee == 'alice'
```

> Condition expressions are not supported inside `dataSource.transaction()` callbacks.

## Optimistic locking

`@VersionAttribute` adds an integer version counter to a table. On `update()`, if the `changes` object includes the version field, the library automatically:

1. Adds a DynamoDB condition: `version = expectedVersion`
2. Increments the stored value to `expectedVersion + 1`

If another process modified the item between your read and write, DynamoDB rejects the update and `OptimisticLockError` is thrown.

```typescript
import { DynamoTable, StringAttribute, VersionAttribute, OptimisticLockError } from 'dynamoose-typed';

@DynamoTable('products')
class ProductTable {
  @StringAttribute({ hashKey: true })
  id!: string;

  @StringAttribute()
  name!: string;

  @VersionAttribute()
  version!: number; // starts at 0, auto-incremented on each update
}
```

```typescript
const repo = dataSource.getRepository(ProductTable);

// save() on a versioned table uses put-if-not-exists semantics
const product = await repo.save({ id: 'p1', name: 'Widget', version: 0 });

// update() with version: optimistic lock applied automatically
try {
  await repo.update({ id: 'p1' }, { name: 'Widget v2', version: 0 });
  // if version in DB is still 0 → succeeds, DB version becomes 1
} catch (err) {
  if (err instanceof OptimisticLockError) {
    // another process wrote between your read and this update
  }
}
```

Omitting the version field from `changes` skips the condition check entirely, making the update unconditional.

## Attribute decorators reference

| Decorator                     | DynamoDB type | Notes                                                                                      |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `@StringAttribute`            | S             | Supports `hashKey`, `rangeKey`, `minLength`, `maxLength`, `trim`, `lowercase`, `uppercase` |
| `@NumberAttribute`            | N             | Supports `min`, `max`                                                                      |
| `@BooleanAttribute`           | BOOL          |                                                                                            |
| `@DateAttribute`              | S / N         | `format: 'epoch'` (default) or `'iso'`; `ttl: true` stores epoch **seconds** and registers as DynamoDB TTL attribute |
| `@CreateDateAttribute`        | S / N         | Set once on insert, never updated; `format: 'epoch'` (default) or `'iso'`                 |
| `@UpdateDateAttribute`        | S / N         | Updated on every save/update; `format: 'epoch'` (default) or `'iso'`                      |
| `@DeleteDateAttribute`        | S / N         | Set by `delete()`, cleared by `restore()`; `index: true` enables sparse-GSI `count()` optimization |
| `@VersionAttribute`           | N             | Starts at `0`; `update()` with version field applies optimistic-lock condition and auto-increments |
| `@NestedAttribute(() => Doc)` | M             | Doc must be decorated with `@DynamoDocument`                                               |
| `@ArrayAttribute(() => Type)` | L             | Primitives or `@DynamoDocument` instances                                                  |
| `@SetAttribute(() => Type)`   | SS / NS       | Must be a `Set<string>` or `Set<number>`                                                   |
| `@Attribute(options)`         | any           | Raw Dynamoose attribute passthrough                                                        |

All decorators accept an optional first argument `alias` (string) to map a TypeScript property name to a different DynamoDB attribute name:

```typescript
@StringAttribute('full_name', { required: true })
fullName!: string;
// stored as "full_name" in DynamoDB, accessed as .fullName in code
```

All decorators also accept `index: true` to create a DynamoDB GSI on that attribute (default name: `${attributeName}GlobalIndex`):

```typescript
@StringAttribute({ index: true })
email!: string; // creates "emailGlobalIndex" GSI
```

## GSI indexes

Pass `index: true` on any attribute decorator to create a DynamoDB GSI:

```typescript
@DynamoTable('users')
class UserTable {
  @StringAttribute({ hashKey: true })
  id!: string;

  @StringAttribute({ index: true }) // GSI: "emailGlobalIndex"
  email!: string;

  // sparse GSI on soft-delete — enables count() optimization
  @DeleteDateAttribute('deleted_at', { index: true })
  deletedAt!: Date | null;
}
```

Use `repo.findByIndex(propertyKey, value)` to query any GSI. The library maps the TypeScript property key to the DynamoDB attribute name (alias-aware) and derives the index name as `${attrName}GlobalIndex`:

```typescript
const { items } = await userRepository.findByIndex('email', 'alice@example.com');
const { items: active } = await userRepository.findByIndex('isActive', true, { limit: 50 });
```

When `index: true` is set on `@DeleteDateAttribute`, `repo.count()` uses a two-`Select: COUNT` strategy instead of scanning item bodies:

```typescript
// 2× Select:COUNT — total minus GSI count (only soft-deleted items appear in the sparse index)
const activeCount = await repo.count();

// plain Select:COUNT — no soft-delete filter needed
const totalCount = await repo.count({ withDeleted: true });
```

| Condition | Strategy | Item bodies |
|---|---|---|
| `withDeleted: true` or no soft-delete | `Select: COUNT` | No |
| Soft-delete + GSI (`index: true`) | 2× `Select: COUNT` (total − GSI) | No |
| Soft-delete, no GSI | Full scan + client-side filter | Yes |

See the [full GSI guide](guides/gsi-indexes.md) for details.

## Hooks

Hooks run before/after each write operation. Declare them on `@DynamoTable`:

```typescript
@DynamoTable('users', {
  hooks: {
    beforeInsert: async (item) => { /* validate, enrich */ },
    afterInsert:  async (item) => { /* emit event */ },
    beforeUpdate: async (item) => { /* audit log */ },
    afterUpdate:  async (item) => { /* cache invalidation */ },
    beforeDelete: async (item) => { /* cascade */ },
    afterDelete:  async (item) => { /* cleanup */ },
  },
})
class UserTable { ... }
```

## Testing with InMemoryDataSource

No DynamoDB connection, no AWS credentials needed. Drop it in wherever you use `DataSource`:

```typescript
import { InMemoryDataSource } from 'dynamoose-typed/testing';

describe('UserService', () => {
  let dataSource: InMemoryDataSource;

  beforeEach(() => {
    dataSource = new InMemoryDataSource({ entities: [UserTable] });
  });

  it('creates and retrieves a user', async () => {
    const repo = dataSource.getRepository(UserTable);
    await repo.save({ id: '1', name: 'Alice', age: 30 });
    const user = await repo.findOneBy({ id: '1' });
    expect(user?.name).toBe('Alice');
  });
});
```

`InMemoryDataSource` exposes the same `getRepository`, `manager`, and `transaction` surface as the real `DataSource`, so your service code under test doesn't change at all.

## Tips

**Attribute aliases keep DynamoDB attribute names decoupled from TypeScript property names.** Use snake_case attribute names in DynamoDB and camelCase properties in code by passing an alias string as the first argument to any attribute decorator.

**Soft deletes are automatic when `@DeleteDateAttribute` is present.** Calling `repo.delete()` sets the column; `repo.restore()` clears it. All queries and scans filter out soft-deleted rows by default — pass `{ withDeleted: true }` to include them. Add `index: true` to enable the sparse-GSI `count()` optimization and avoid full scans.

**`repo.delete()` falls back to a hard delete when the entity has no `@DeleteDateAttribute`.** No soft-delete column → `delete()` permanently removes the item, identical to calling `hardDelete()` directly. Tables that need both behaviors should declare `@DeleteDateAttribute` and call `hardDelete()` explicitly when a permanent removal is intended.

**`getRepository` lazy-initializes the DataSource** if you haven't called `initialize()` yet. This is useful for lightweight scripts that don't need an explicit boot sequence.

**Timestamp storage format defaults to `epoch` (milliseconds as Number).** Pass `{ format: 'iso' }` to store as ISO-8601 strings instead. The `Date` native storage type is no longer supported.

**Use `@DateAttribute({ ttl: true })` for DynamoDB TTL.** The value is stored as epoch **seconds** (not milliseconds). Set the property to a future `Date` and DynamoDB will automatically delete the item after that point. The library handles the seconds-vs-milliseconds conversion transparently.

```typescript
@DateAttribute('expires_at', { ttl: true })
expiresAt!: Date;

// set TTL to 24 hours from now
await repo.save({ id: '1', expiresAt: new Date(Date.now() + 86400_000) });
```

**`select` projections reduce read cost on large items.** The library calls DynamoDB's `ProjectionExpression` server-side — only the requested attributes are returned. The TypeScript return type is narrowed to `Pick<T, selectedKeys>` automatically. When soft-delete is active, the `deletedAt` attribute is silently injected into the projection so filtering works correctly, then stripped from the result.

**`@VersionAttribute` does not protect inserts — only updates.** On `save()` the library uses `overwrite: false` (put-if-not-exists). On `update()`, pass the version you read from DynamoDB in `changes`; omit it to skip the check. The version is never auto-read — you own the read-then-write cycle.

**DynamoDB transactions have a hard limit of 100 items.** If your callback enqueues more than 100 writes, DynamoDB will reject the flush. Split large transactions into smaller chunks.

**`InMemoryDataSource.clear()` resets all in-memory data.** Call it in `beforeEach` to keep tests isolated:

```typescript
beforeEach(() => dataSource.clear());
```

## Support

If you find this project useful, please consider supporting its development:

<a href="https://buymeacoffee.com/leandroluk" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 42px !important;width: 151.2px !important;" ></a>

