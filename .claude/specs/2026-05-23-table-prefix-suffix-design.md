# Table Prefix/Suffix Feature Design

**Date:** 2026-05-23  
**Status:** Approved

## Problem

DynamoDB does not support multiple databases per AWS account. Companies share a single DynamoDB instance across environments using table name conventions (e.g. `prod_users`, `staging_users`). The library already supports region-based separation but not name-based prefix/suffix.

## Goal

Allow `DataSource` (and `InMemoryDataSource`) to accept a `table.prefix` and `table.suffix` option that is applied to every registered entity's table name at initialization time.

**Example:**
```ts
const ds = new DataSource({
  entities: [UserTable],
  table: { prefix: 'prod_' },
});
// @DynamoTable('users') → resolves to 'prod_users' in DynamoDB
```

## Architecture

### Interface change — `DataSourceOptions`

Add optional `table` property to `DataSourceOptions`:

```ts
export interface DataSourceOptions {
  entities: (new () => unknown)[];
  documentClient?: DynamoDB | DynamoDBClient;
  local?: boolean | { host?: string; port?: number };

  /**
   * Global table name transformations applied to all registered entities.
   * Applied at DataSource initialization time.
   */
  table?: {
    /** Prepended to every table name. E.g. 'prod_' → 'prod_users' */
    prefix?: string;
    /** Appended to every table name. E.g. '_v2' → 'users_v2' */
    suffix?: string;
  };
}
```

No changes to `@DynamoTable` decorator or `ResolvedSchema` interface.

### Transform location — `DataSource.#register()`

The transformation is applied in `DataSource.#register()` after calling `resolveTableSchema()`:

```ts
#register(entityClass: new () => unknown): void {
  if (this.#models.has(entityClass)) return;

  const resolved = resolveTableSchema(entityClass);
  const prefix = this.#options.table?.prefix ?? '';
  const suffix = this.#options.table?.suffix ?? '';
  const tableName = `${prefix}${resolved.tableName}${suffix}`;

  const dSchema = new dynamoose.Schema(resolved.definition, resolved.schemaOptions);
  const dModel = dynamoose.model(tableName, dSchema);
  new this.#instance.Table(tableName, [dModel], resolved.tableOptions);

  this.#models.set(
    entityClass as new () => unknown,
    new InternalModel(entityClass as new () => AnyItem, { ...resolved, tableName }, dModel)
  );
}
```

`resolveTableSchema()` remains pure — returns the base decorator name. Only `DataSource` applies the transformation.

### `InMemoryDataSource` mirror

Same `table` option added to `InMemoryDataSource` constructor options:

```ts
constructor(options: {
  entities: (new () => unknown)[];
  table?: { prefix?: string; suffix?: string };
})
```

Applied in the same place (constructor loop), before passing the schema to `InMemoryRepository`.

## Files Changed

| File | Change |
|------|--------|
| `src/data-source/data-source.ts` | Add `table` to `DataSourceOptions`; apply in `#register()` |
| `src/testing/in-memory-data-source.ts` | Add `table` to constructor options; apply in constructor loop |

No changes to:
- `src/decorators/class.decorators.ts`
- `src/schema/schema-builder.ts`
- `src/types/meta.types.ts`
- `src/decorators/metadata.registry.ts`

## Behavior

| Options | `@DynamoTable('users')` result |
|---------|-------------------------------|
| `table: undefined` | `users` |
| `table: { prefix: 'prod_' }` | `prod_users` |
| `table: { suffix: '_v2' }` | `users_v2` |
| `table: { prefix: 'prod_', suffix: '_v2' }` | `prod_users_v2` |
| `table: { prefix: '', suffix: '' }` | `users` |

## Testing

Tests via `InMemoryDataSource` (no DynamoDB required). Four cases:

1. `prefix` only → `prod_users`
2. `suffix` only → `users_v2`
3. Both → `prod_users_v2`
4. Neither (backward compatibility) → `users`

Test approach: verify `schema.tableName` in `InMemoryRepository` after construction.

## Backward Compatibility

Fully backward compatible. `table` is optional; omitting it preserves current behavior.
