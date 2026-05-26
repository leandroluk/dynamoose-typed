# Throughput Configuration

DynamoDB supports two billing modes:

- **ON_DEMAND** — pay-per-request, scales automatically. No capacity planning needed.
- **Provisioned** — fixed read/write capacity units. Cheaper at steady high-volume, but requires planning.

## Per-table configuration

Pass `throughput` to `@DynamoTable`:

```typescript
import { DynamoTable, StringAttribute, ThroughputOptions } from 'dynamoose-typed';

// ON_DEMAND — recommended for most use cases
@DynamoTable('users', { throughput: 'ON_DEMAND' })
class UserTable { ... }

// Provisioned — same capacity for read and write
@DynamoTable('logs', { throughput: 5 })
class LogTable { ... }

// Provisioned — separate read/write
@DynamoTable('orders', { throughput: { read: 10, write: 5 } })
class OrderTable { ... }
```

## Global default

Set a default for all tables via `DataSourceOptions.table.throughput`. Per-table settings override it:

```typescript
import { DynamoDB } from '@aws-sdk/client-dynamodb';

const dataSource = new DataSource({
  entities: [UserTable, OrderTable, LogTable],
  client: new DynamoDB({ region: 'us-east-1' }),
  table: {
    throughput: 'ON_DEMAND', // default for all tables
  },
});

// UserTable  → ON_DEMAND (per-table setting wins)
// OrderTable → { read: 10, write: 5 } (per-table setting wins)
// LogTable   → ON_DEMAND (inherits global default)
```

## Precedence

| Per-table `@DynamoTable({ throughput })` | Global `DataSourceOptions.table.throughput` | Effective |
|---|---|---|
| `'ON_DEMAND'` | `{ read: 5, write: 5 }` | `'ON_DEMAND'` |
| `undefined` | `'ON_DEMAND'` | `'ON_DEMAND'` |
| `undefined` | `undefined` | Dynamoose default (`read: 5, write: 5`) |
| `{ read: 10, write: 5 }` | `'ON_DEMAND'` | `{ read: 10, write: 5 }` |

## Note on table creation

`throughput` only affects tables **created by Dynamoose** (when `create: true` in table options, which is the default). If your tables are pre-created (e.g. via Terraform or CDK), this setting has no effect at runtime.
