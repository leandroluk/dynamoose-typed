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
- Atomic transactions via `dataSource.transaction()`
- Batch operations (`batchSave`, `batchGet`, `batchDelete`)
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
import * as uuid from 'uuid';

@DynamoTable('users', {
  hooks: {
    beforeInsert: (item) => console.log('inserting', item),
  },
})
class UserTable {
  @StringAttribute({ hashKey: true, default: uuid.v7 })
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

@DynamoDocument()
class AddressDocument {
  @StringAttribute({ required: true })
  street!: string;

  @StringAttribute({ required: true })
  city!: string;
}

@DynamoTable('orders')
class OrderTable {
  @StringAttribute({ hashKey: true, default: uuid.v7 })
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

// full-table scan
const { items: allUsers } = await userRepository.scan({ withDeleted: false });

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

## Attribute decorators reference

| Decorator                     | DynamoDB type | Notes                                                                                      |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `@StringAttribute`            | S             | Supports `hashKey`, `rangeKey`, `minLength`, `maxLength`, `trim`, `lowercase`, `uppercase` |
| `@NumberAttribute`            | N             | Supports `min`, `max`                                                                      |
| `@BooleanAttribute`           | BOOL          |                                                                                            |
| `@DateAttribute`              | S / N / B     | Storage type controlled by `type` option                                                   |
| `@CreateDateAttribute`        | S / N / B     | Set once on insert, never updated                                                          |
| `@UpdateDateAttribute`        | S / N / B     | Updated on every save/update                                                               |
| `@DeleteDateAttribute`        | S / N / B     | Set by `delete()`, cleared by `restore()`                                                  |
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

**Soft deletes are automatic when `@DeleteDateAttribute` is present.** Calling `repo.delete()` sets the column; `repo.restore()` clears it. All queries and scans filter out soft-deleted rows by default — pass `{ withDeleted: true }` to include them.

**`getRepository` lazy-initializes the DataSource** if you haven't called `initialize()` yet. This is useful for lightweight scripts that don't need an explicit boot sequence.

**Timestamp storage type defaults to `Date` (native JavaScript Date).** Pass `{ type: String }` for ISO-8601 strings or `{ type: Number }` for epoch milliseconds to match your existing table schema.

**DynamoDB transactions have a hard limit of 100 items.** If your callback enqueues more than 100 writes, DynamoDB will reject the flush. Split large transactions into smaller chunks.

**`InMemoryDataSource.clear()` resets all in-memory data.** Call it in `beforeEach` to keep tests isolated:

```typescript
beforeEach(() => dataSource.clear());
```
