# Example — Users

A full walkthrough of a `users` table: nested documents, all attribute decorators,
soft-delete timestamps, hooks, and every CRUD operation via both manager and repository.

## Nested documents

```ts
import {
  ArrayAttribute,
  BooleanAttribute,
  CreateDateAttribute,
  DataSource,
  DateAttribute,
  DeleteDateAttribute,
  DynamoDocument,
  DynamoTable,
  NestedAttribute,
  NumberAttribute,
  SetAttribute,
  StringAttribute,
  UpdateDateAttribute,
} from 'dynamoose-typed';
import type { TransactionManager } from 'dynamoose-typed';
import * as uuid from 'uuid';

@DynamoDocument({ saveUnknown: true })
class AddressDocument {
  @StringAttribute({ required: true })
  street!: string;

  @StringAttribute({ required: true })
  city!: string;

  @StringAttribute({ required: true })
  zip!: string;
}

@DynamoDocument({ saveUnknown: true })
class ContractDocument {
  @StringAttribute({ required: true })
  type!: string;

  @StringAttribute({ required: true })
  number!: string;

  @DateAttribute('start_date')
  startDate!: Date;

  @DateAttribute('end_date')
  endDate!: Date;
}
```

## Table entity

```ts
@DynamoTable('users', {
  saveUnknown: true,
  hooks: {
    beforeInsert: (item: UserTable) => console.log('inserting', item.id),
    afterInsert:  (item: UserTable) => console.log('inserted',  item.id),
    beforeUpdate: (item: UserTable) => console.log('updating',  item.id),
    afterUpdate:  (item: UserTable) => console.log('updated',   item.id),
    beforeDelete: (item: UserTable) => console.log('deleting',  item.id),
    afterDelete:  (item: UserTable) => console.log('deleted',   item.id),
  },
})
class UserTable {
  @StringAttribute({ hashKey: true, default: uuid.v7, trim: true, required: true })
  id!: string;

  @StringAttribute({ required: true, minLength: 3, maxLength: 100 })
  name!: string;

  @NumberAttribute({ required: true, min: 18, max: 120 })
  age!: number;

  @BooleanAttribute('is_active', { default: false })
  isActive!: boolean;

  @NestedAttribute(() => AddressDocument)
  address!: AddressDocument;

  @ArrayAttribute(() => String, { default: () => [] })
  hobbies!: string[];

  @SetAttribute(() => String, { default: () => new Set() })
  roles!: Set<string>;

  @ArrayAttribute(() => ContractDocument)
  contracts!: ContractDocument[];

  // stored as ISO-8601 string
  @CreateDateAttribute('created_at', { type: String })
  createdAt!: Date;

  // stored as epoch milliseconds
  @UpdateDateAttribute('updated_at', { type: Number })
  updatedAt!: Date;

  // stored as native Date; set by delete(), cleared by restore()
  @DeleteDateAttribute('deleted_at', { type: Date })
  deletedAt!: Date | null;
}
```

## DataSource setup

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const dataSource = new DataSource({
  entities: [UserTable],
  documentClient: new DynamoDBClient({ region: 'us-east-1' }),
});

await dataSource.initialize();
```

## Usage

### Find

```ts
// via manager
const userFromManager = await dataSource.manager.findOneBy(UserTable, { id: '1' });

// via repository
const userFromRepo = await dataSource.getRepository(UserTable).findOneBy({ id: '1' });

// include soft-deleted items
const deletedUser = await dataSource.manager.findOneBy(UserTable, { id: '1' }, { withDeleted: true });

// throw if not found
const requiredUser = await dataSource.manager.findOneByOrFail(UserTable, { id: '1' });
```

### Create

```ts
// in-memory only — no persistence
const userFromManager = dataSource.manager.create(UserTable, { id: uuid.v7(), name: 'Alice', age: 30 });
const userFromRepo    = dataSource.getRepository(UserTable).create({ id: uuid.v7(), name: 'Bob', age: 25 });
```

### Save

```ts
await dataSource.manager.save(userFromManager);
await dataSource.getRepository(UserTable).save(userFromRepo);
```

### Update

```ts
await dataSource.manager.update(UserTable, { id: '1' }, { name: 'Alice Updated' });
await dataSource.getRepository(UserTable).update({ id: '1' }, { age: 31 });
```

### Count

```ts
const total        = await dataSource.manager.count(UserTable);
const totalWithDel = await dataSource.getRepository(UserTable).count({ withDeleted: true });
```

### Scan & query

```ts
// full-table scan (excludes soft-deleted by default)
const { items: allUsers } = await dataSource.manager.scan(UserTable);

// query by hash key with pagination
const { items, count, lastKey } = await dataSource.manager.find(UserTable, 'alice-partition', {
  limit: 20,
  consistent: true,
});
```

### Delete & restore

```ts
// soft delete — sets deleted_at
await dataSource.manager.delete(UserTable, { id: '1' });
await dataSource.getRepository(UserTable).delete({ id: '1' });

// hard delete — permanently removes the item
await dataSource.manager.hardDelete(UserTable, { id: '1' });
await dataSource.getRepository(UserTable).hardDelete({ id: '1' });

// restore a soft-deleted item
await dataSource.manager.restore(UserTable, { id: '1' });
await dataSource.getRepository(UserTable).restore({ id: '1' });
```

### Batch operations

```ts
const repo = dataSource.getRepository(UserTable);

await repo.batchSave([userFromManager, userFromRepo]);

const results = await repo.batchGet([{ id: '1' }, { id: '2' }]);

await repo.batchDelete([{ id: '1' }, { id: '2' }]);
```

### Transactions

Reads execute immediately; writes are collected and flushed atomically when the callback resolves.

```ts
await dataSource.transaction(async (tx: TransactionManager) => {
  const user = await tx.findOneByOrFail(UserTable, { id: '1' });
  user.name = 'Updated inside transaction';
  await tx.save(user); // enqueued — not written yet

  await tx.delete(UserTable, { id: '2' }); // enqueued
});
// both writes committed atomically here
```
