# GSI Indexes

Any attribute decorator accepts `index: true` to create a DynamoDB Global Secondary Index (GSI) on that attribute. The default GSI name is `${attributeName}GlobalIndex`.

## Declaring a GSI

```ts
@DynamoTable('users')
class UserTable {
  @StringAttribute({ hashKey: true })
  id!: string;

  // creates a GSI named "emailGlobalIndex"
  @StringAttribute('email', { index: true })
  email!: string;

  // creates a GSI named "statusGlobalIndex"
  @StringAttribute({ index: true })
  status!: string;
}
```

Works on all attribute types: `@StringAttribute`, `@NumberAttribute`, `@BooleanAttribute`, `@DateAttribute`, `@CreateDateAttribute`, `@UpdateDateAttribute`, `@DeleteDateAttribute`, `@NestedAttribute`, `@ArrayAttribute`, `@SetAttribute`.

## Querying a GSI

Use `repo.findByIndex(propertyKey, hashValue, options?)`. The library maps the TypeScript property key to the DynamoDB attribute name (respecting aliases) and derives the index name automatically.

```ts
@DynamoTable('users')
class UserTable {
  @StringAttribute({ hashKey: true })
  id!: string;

  // DynamoDB attribute name: "email" → GSI name: "emailGlobalIndex"
  @StringAttribute({ index: true })
  email!: string;

  // alias "is_active" → GSI name: "is_activeGlobalIndex"
  @BooleanAttribute('is_active', { index: true })
  isActive!: boolean;

  @DeleteDateAttribute('deleted_at', { index: true })
  deletedAt!: Date | null;
}

const repo = dataSource.getRepository(UserTable);

// query by email GSI
const { items, count, lastKey } = await repo.findByIndex('email', 'alice@example.com');

// query with pagination and consistent read
const page = await repo.findByIndex('email', 'alice@example.com', {
  limit: 20,
  consistent: true,
  startAt: lastKey,
});

// include soft-deleted results
const all = await repo.findByIndex('isActive', true, { withDeleted: true });
```

Soft-deleted items are filtered out by default (same behaviour as `find()` and `scan()`). Pass `{ withDeleted: true }` to include them.

Via `EntityManager`:

```ts
const { items } = await dataSource.manager.findByIndex(UserTable, 'email', 'alice@example.com');
```

## Sparse GSI optimization on `@DeleteDateAttribute`

When `index: true` is set on `@DeleteDateAttribute`, `repo.count()` (without `withDeleted`) automatically uses a two-`Select: COUNT` strategy instead of scanning all items:

```
non_deleted_count = total_count - deleted_gsi_count
```

This works because DynamoDB GSIs do not index `NULL`-type attribute values. `restore()` stores `deleted_at = NULL` (DynamoDB NULL type), so restored items are excluded from the GSI — only truly soft-deleted items appear there. The result is exact.

**Both scans use `Select: COUNT`** — no item bodies are transferred, making this significantly cheaper for large tables.

```ts
@DynamoTable('users')
class UserTable {
  @StringAttribute({ hashKey: true })
  id!: string;

  // enables the sparse GSI count optimization
  @DeleteDateAttribute('deleted_at', { index: true })
  deletedAt!: Date | null;
}
```

```ts
const repo = dataSource.getRepository(UserTable);

// path 1 — Select:COUNT, no soft-delete filter needed
const total = await repo.count({ withDeleted: true });

// path 2 — 2× Select:COUNT via sparse GSI (no item bodies)
const active = await repo.count();

// path 3 — fallback full scan + client-side filter (no GSI defined)
// (this path is taken when index: true is NOT set on @DeleteDateAttribute)
const activeNoGsi = await repo.count();
```

## Count behavior summary

| Condition | Strategy | Item bodies transferred |
|---|---|---|
| `withDeleted: true` or no soft-delete | `Select: COUNT` | No |
| Soft-delete present + GSI defined (`index: true`) | 2× `Select: COUNT` (total − GSI) | No |
| Soft-delete present, no GSI | Full scan + client-side filter | Yes |

## Infrastructure note

Declaring `index: true` adds the GSI to the Dynamoose schema definition. DynamoDB table provisioning (creating the actual GSI) is handled by Dynamoose's table management or your own IaC (CDK, Terraform, etc.) — `dynamoose-typed` only controls what goes into the schema.
