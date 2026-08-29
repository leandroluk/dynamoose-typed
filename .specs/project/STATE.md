# STATE

_Hot working state. Persistent memory across sessions. Keep < 30 KB._

## Now

- **Done (uncommitted → committing):** `named-gsi-query` feature — `findByIndex`
  can query custom-named GSIs. See `.specs/features/named-gsi-query/spec.md`.
- Version bumped `1.10.4` → `1.11.0`. README + CHANGELOG updated.

## Recent Changes (window: last 5)

1. `named-gsi-query` — `ResolvedSchema.indexMap` (property key → GSI name);
   `Repository.findByIndex` / `EntityManager.findByIndex` resolve index name from
   `options.indexName` → `schema.indexMap` → `${attr}GlobalIndex` fallback;
   `deleteDateIndexName` now honours custom `index: { name }`.
   Files: `src/schema/schema-builder.ts`, `src/repository/repository.ts`,
   `src/manager/entity-manager.ts`, `src/testing/in-memory-repository.ts`,
   `test/schema-builder.test.ts`, `test/repository-real.test.ts`, `test/fixtures.ts`.

## Decisions (window: last 5)

- **Index-name resolution order:** explicit `options.indexName` wins, then the
  declared `index` name (new `schema.indexMap`), then the legacy
  `${attrName}GlobalIndex` derivation as a fallback so string-cast keys used in
  existing tests keep working. Backward compatible — no behaviour change for
  `index: true`.
- **No GSI range-key conditions** added to `findByIndex` in this change (still
  filter-only) — kept out of scope.

## Verification

- `pnpm test` → 463 passed (18 files). `npx tsc --noEmit` clean. `oxlint --type-aware` clean. `pnpm build` OK (.d.ts emit verified).

## Cost

- graph build (code-only): 0 tokens (local AST). 697 nodes / 1815 edges / 32 communities.
