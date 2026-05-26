# Table Name Prefix/Suffix

DynamoDB has no concept of multiple databases — a single account shares one namespace for table names. If your application runs in multiple environments (production, staging, development) on the same AWS account, you need a naming convention to avoid conflicts.

`dynamoose-typed` supports global prefix/suffix transformation via the `table` option on `DataSourceOptions`.

## Usage

```typescript
import { DataSource } from 'dynamoose-typed';
import { DynamoDB } from '@aws-sdk/client-dynamodb';

// All entity table names are prepended with 'prod_'
// @DynamoTable('users')  → 'prod_users'
// @DynamoTable('orders') → 'prod_orders'
const dataSource = new DataSource({
  entities: [UserTable, OrderTable],
  client: new DynamoDB({ region: 'us-east-1' }),
  table: { prefix: 'prod_' },
});

await dataSource.initialize();
```

## Options

| Option         | Type                | Description                    |
| -------------- | ------------------- | ------------------------------ |
| `table.prefix` | `string` (optional) | Prepended to every table name. |
| `table.suffix` | `string` (optional) | Appended to every table name.  |

Both options can be used together. If neither is set, table names are used as declared in `@DynamoTable`.

## Patterns

### Environment-based prefix

```typescript
const env = process.env.NODE_ENV; // 'prod' | 'staging' | 'dev'

const dataSource = new DataSource({
  entities: [UserTable, OrderTable],
  client: new DynamoDB({ region: 'us-east-1' }),
  table: { prefix: `${env}_` },
});
// prod_users, staging_users, dev_users
```

### Version-based suffix

```typescript
const dataSource = new DataSource({
  entities: [UserTable],
  client: new DynamoDB({ region: 'us-east-1' }),
  table: { suffix: '_v2' },
});
// users_v2
```

### Combined

```typescript
const dataSource = new DataSource({
  entities: [UserTable],
  client: new DynamoDB({ region: 'us-east-1' }),
  table: { prefix: 'prod_', suffix: '_v2' },
});
// prod_users_v2
```

## Testing

`InMemoryDataSource` accepts the same `table` option so naming conventions can be verified in unit tests without a DynamoDB connection:

```typescript
import { InMemoryDataSource } from 'dynamoose-typed/testing';

const ds = new InMemoryDataSource({
  entities: [UserTable],
  table: { prefix: 'prod_' },
});

const repo = ds.getRepository(UserTable);
expect(repo.tableName).toBe('prod_users');
```

## Behavior reference

| `table` option                       | `@DynamoTable('users')` resolves to |
| ------------------------------------ | ----------------------------------- |
| `undefined` (omitted)                | `users`                             |
| `{ prefix: 'prod_' }`                | `prod_users`                        |
| `{ suffix: '_v2' }`                  | `users_v2`                          |
| `{ prefix: 'prod_', suffix: '_v2' }` | `prod_users_v2`                     |
| `{ prefix: '', suffix: '' }`         | `users`                             |
