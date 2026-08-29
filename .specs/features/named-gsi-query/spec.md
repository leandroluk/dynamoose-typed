# Feature: Query GSIs by their declared (custom) name

**Status:** ✅ Implemented in 1.11.0 — all REQ met, 463 tests green.

## Problem

`Repository.findByIndex(propertyKey, value)` derives the DynamoDB index name as
`` `${attrName}GlobalIndex` `` (`src/repository/repository.ts:239`). This is the
Dynamoose default name, but an attribute can declare a **custom** GSI name:

```ts
@StringAttribute('parent_id', { index: { name: 'parentIdIndex', rangeKey: 'createdAt' } })
userIdOwner!: string;
```

The physical GSI is `parentIdIndex`, but `findByIndex('userIdOwner', v)` issues
`.using('parent_idGlobalIndex')` → DynamoDB `ValidationException` (index not
found). Result: **custom-named GSIs cannot be queried through the typed API**, so
consumers fall back to full-table `scan()` — O(table) per call, latency grows
unbounded with table size.

## Requirements

- **REQ-001** `resolveTableSchema` exposes `indexMap: Record<string, string>` —
  maps entity **property key** → resolved GSI name.
  - `index: true` → `` `${attributeName}GlobalIndex` `` (unchanged default)
  - `index: { name: 'X', ... }` → `'X'`
  - `index: { rangeKey: ... }` (object, no `name`) → `` `${attributeName}GlobalIndex` ``
  - attribute without `index` → absent from the map
  - covers every attribute kind that supports `index` (string, number, boolean,
    date, createDate, updateDate, deleteDate, nested, array, set)
- **REQ-002** `Repository.findByIndex` resolves the index name in this order:
  1. `options.indexName` (explicit override), else
  2. `schema.indexMap[attributeKey]`, else
  3. `` `${attrName}GlobalIndex` `` (fallback — keeps behaviour for keys not in
     the map, e.g. ad-hoc string casts used in existing tests)
- **REQ-003** `EntityManager.findByIndex` forwards `options.indexName` (option
  type widened; it already spreads options through).
- **REQ-004** Backward compatible: existing `index: true` call sites and tests
  (`is_activeGlobalIndex`, `emailGlobalIndex`, …) keep working with no change.
- **REQ-005** Docs updated: README "GSI indexes" section + CHANGELOG entry.
- **REQ-006** Version bump `1.10.4` → `1.11.0` (additive feature).

## Non-goals

- GSI range-key (`sortKey`) conditions on `findByIndex` — still filter-only.
- Auto-routing `scan()`-style predicate queries to an index (that lives in the
  consumer's repository layer, `@packages/nest-database`).
- Renaming or migrating any physical index.

## Affected files

- `src/schema/schema-builder.ts` — build + expose `indexMap`
- `src/repository/repository.ts` — index-name resolution + `indexName` option
- `src/manager/entity-manager.ts` — widen `findByIndex` options type
- `test/schema-builder.test.ts`, `test/repository-real.test.ts` — coverage
- `README.md`, `CHANGELOG.md`, `package.json`
