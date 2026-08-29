# dynamoose-typed

TypeScript-first, decorator-driven ORM layer over [dynamoose](https://dynamoosejs.com/)
for DynamoDB. Mirrors TypeORM ergonomics: `DataSource`, `EntityManager`,
`Repository<T>`, `@DynamoTable` / `@*Attribute` decorators, alias mapping, soft
delete, optimistic locking, TTL, and DynamoDB Streams subscriptions.

## Layout

- `src/decorators/` — `@DynamoTable`, `@DynamoDocument`, attribute decorators, metadata registry
- `src/schema/schema-builder.ts` — `resolveTableSchema()` → `ResolvedSchema` (decorator metadata → dynamoose schema)
- `src/model/internal-model.ts` — wraps the raw dynamoose model, alias/timestamp normalization
- `src/repository/repository.ts` — typed CRUD + query surface (`findOneBy`, `findByIndex`, `find`, `scan`, `count`, ...)
- `src/manager/` — `EntityManager` (cross-entity) + `TransactionManager`
- `src/streams/` — DynamoDB Streams poller for `Repository.subscribe()`
- `src/testing/` — in-memory `DataSource` / `Repository` for consumer unit tests

## Build & test

- `pnpm build` — `tsup` (ESM+CJS) + `tsc` (.d.ts) + `scripts/fix-dts-aliases.mjs`
- `pnpm test` — vitest (`dynamoose` mocked in `test/repository-real.test.ts`)
- Conventional Commits enforced (commitlint + lefthook)

## Consumers

`@packages/nest-database` in the `metha-energia/workspace` monorepo pins this
package and wraps `Repository` in its own `DatabaseDynamooseTypedRepository`.
