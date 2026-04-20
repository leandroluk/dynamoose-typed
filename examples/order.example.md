# Example — Orders

A multi-entity example with a composite primary key (hash + range), demonstrating
manager, repository, batch operations, transactions, and lazy initialization.

## Entity definitions

```ts
import {
  DataSource,
  DynamoTable,
  NumberAttribute,
  StringAttribute,
} from 'dynamoose-typed';

@DynamoTable('users')
class UserEntity {
  @StringAttribute({ hashKey: true, required: true })
  id!: string;

  @StringAttribute({ required: true })
  name!: string;

  @StringAttribute({ required: true })
  email!: string;
}

@DynamoTable('orders')
class OrderEntity {
  // composite key: userId (hash) + orderId (range)
  @StringAttribute({ hashKey: true, required: true })
  userId!: string;

  @StringAttribute({ rangeKey: true, required: true })
  orderId!: string;

  @StringAttribute({ required: true })
  product!: string;

  @NumberAttribute({ default: 0 })
  quantity!: number;

  @StringAttribute({ enum: ['pending', 'shipped', 'delivered'] as const })
  status!: 'pending' | 'shipped' | 'delivered';
}
```

## DataSource setup

```ts
const dataSource = new DataSource({
  entities: [UserEntity, OrderEntity],
});

// explicit initialization — registers all models upfront
await dataSource.initialize();
```

## Via manager

```ts
// find by simple hash key
const user = await dataSource.manager.findOneBy(UserEntity, { id: '1' });

// find by composite key
const order = await dataSource.manager.findOneBy(OrderEntity, { userId: 'u1', orderId: 'o1' });

// find or throw
const requiredOrder = await dataSource.manager.findOneByOrFail(OrderEntity, { userId: 'u1', orderId: 'o1' });

// create and save
const newUser = dataSource.manager.create(UserEntity, { id: '2', name: 'Alice', email: 'alice@example.com' });
await dataSource.manager.save(newUser);

// partial update
await dataSource.manager.update(OrderEntity, { userId: 'u1', orderId: 'o1' }, { status: 'shipped' });

// delete
await dataSource.manager.delete(UserEntity, { id: '2' });

// query all orders for a user (by hash key)
const { items: userOrders } = await dataSource.manager.find(OrderEntity, 'u1', { limit: 20 });

// full-table scan
const { items: allOrders } = await dataSource.manager.scan(OrderEntity);
```

## Via repository

```ts
const orderRepo = dataSource.getRepository(OrderEntity);

// save a single order
await orderRepo.save({ userId: 'u3', orderId: 'o3', product: 'Desk', quantity: 1, status: 'pending' });

// find
const foundOrder        = await orderRepo.findOneBy({ userId: 'u3', orderId: 'o3' });
const foundOrderOrFail  = await orderRepo.findOneByOrFail({ userId: 'u3', orderId: 'o3' });

// batch save
await orderRepo.batchSave([
  { userId: 'u4', orderId: 'o4', product: 'Chair', quantity: 2, status: 'pending' } as OrderEntity,
  { userId: 'u4', orderId: 'o5', product: 'Lamp',  quantity: 1, status: 'pending' } as OrderEntity,
]);

// batch get
const batchResults = await orderRepo.batchGet([
  { userId: 'u4', orderId: 'o4' },
  { userId: 'u4', orderId: 'o5' },
]);

// batch delete
await orderRepo.batchDelete([
  { userId: 'u4', orderId: 'o4' },
  { userId: 'u4', orderId: 'o5' },
]);
```

## Transactions

Reads execute immediately; writes are collected and flushed atomically when the callback resolves.
If the callback throws, no writes are flushed.

```ts
await dataSource.transaction(async (tx) => {
  // read executes immediately
  const existingOrder = await tx.findOneByOrFail(OrderEntity, { userId: 'u1', orderId: 'o1' });

  // writes are enqueued
  await tx.save(
    { userId: 'u2', orderId: 'o2', product: 'Pen', quantity: 3, status: 'pending' },
    OrderEntity,
  );
  await tx.update(OrderEntity, { userId: 'u1', orderId: 'o1' }, { status: 'delivered' });
  await tx.delete(OrderEntity, { userId: 'u1', orderId: 'o3' });
});
// all three writes committed atomically here
```

## Lazy initialization

`getRepository()` auto-initializes the DataSource on first use — no explicit `initialize()` needed.

```ts
const lazyDataSource = new DataSource({ entities: [UserEntity], local: true });

// triggers lazy init internally
const userRepo = lazyDataSource.getRepository(UserEntity);
const lazyUser = await userRepo.findOneBy({ id: '99' });
```
