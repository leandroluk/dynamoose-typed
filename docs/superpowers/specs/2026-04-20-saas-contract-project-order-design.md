# SaaS — Contract, Project & Order Design

**Date:** 2026-04-20
**Status:** Approved

## Context

Multi-tenant SaaS for contract and project management (obras/construção civil). Existing namespaces: `Shared`, `Identity`, `Tenant`, `People`. This spec covers updates to existing namespaces and three new namespaces: `Commercial`, `Project`, `Order`.

## Updates to Existing Namespaces

### Tenant.CostCenterEntity
Add `cost_center_id_parent: NULL | UUID` (self-referential recursive hierarchy).
Add `is_default: BOOLEAN`.

Every organization creation triggers automatic creation of one default CostCenter (`is_default = true`).

### Tenant.DepartmentEntity
Add `department_id_parent: NULL | UUID` (self-referential recursive hierarchy).
Add `is_default: BOOLEAN`.

Every organization creation triggers automatic creation of one default Department (`is_default = true`).

> Naming convention for recursive keys: `{entity_name}_id_parent` (e.g., `cost_center_id_parent`).

## Namespace: Commercial

Covers the commercial side of projects — resource catalog and contracts.

### Commercial.ResourceEntity (polymorphic root)
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
updated_at: TIMESTAMPTZ[3]
deleted_at: NULL | TIMESTAMPTZ[3]
organization_id: Tenant.OrganizationEntity(id)
name: VARCHAR[100]
```
Scoped per tenant. Acts as catalog — reusable across multiple contracts.

### Subtypes
```
Commercial.LaborResourceEntity       -- mão de obra
  resource_id: Commercial.ResourceEntity(id)

Commercial.ServiceResourceEntity     -- serviços
  resource_id: Commercial.ResourceEntity(id)

Commercial.EquipmentResourceEntity   -- equipamentos
  resource_id: Commercial.ResourceEntity(id)
```
Same polymorphic pattern as `People.PersonEntity → LegalPerson/RealPerson`.

### Commercial.ContractEntity
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
updated_at: TIMESTAMPTZ[3]
deleted_at: NULL | TIMESTAMPTZ[3]
organization_id: Tenant.OrganizationEntity(id)
project_id: Project.ProjectEntity(id)
contractor_person_id: People.PersonEntity(id)   -- contratado (CNPJ executor)
client_person_id: People.PersonEntity(id)        -- contratante (ex: Gerdau)
number: VARCHAR[50]
description: TEXT
signed_at: NULL | TIMESTAMPTZ[3]
starts_at: NULL | TIMESTAMPTZ[3]
ends_at: NULL | TIMESTAMPTZ[3]
```

### Commercial.ContractItemEntity (immutable snapshot)
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
contract_id: Commercial.ContractEntity(id)
resource_id: Commercial.ResourceEntity(id)
description: TEXT
unit: VARCHAR[20]
unit_price: NUMERIC
qty: NUMERIC
```
Snapshot of price/qty at contract creation. Never updated after creation. Enables historical reporting with accurate pricing even if resource changes.

## Namespace: Project

### Project.ProjectEntity
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
updated_at: TIMESTAMPTZ[3]
deleted_at: NULL | TIMESTAMPTZ[3]
organization_id: Tenant.OrganizationEntity(id)
cost_center_id: Tenant.CostCenterEntity(id)    -- required, 1:1
department_id: Tenant.DepartmentEntity(id)      -- required, 1:1
name: VARCHAR[100]
description: NULL | TEXT
starts_at: NULL | TIMESTAMPTZ[3]
ends_at: NULL | TIMESTAMPTZ[3]
```
One cost center and one department per project — prevents split cost attribution and dual management.

### Project.AreaEntity (recursive)
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
updated_at: TIMESTAMPTZ[3]
deleted_at: NULL | TIMESTAMPTZ[3]
project_id: Project.ProjectEntity(id)
area_id_parent: NULL | Project.AreaEntity(id)
name: VARCHAR[100]
```
Root area (no parent) is the top-level grouping. Orders can be created in any area, including sub-areas. Every project requires at least one area.

## Namespace: Order

### Order.OrderStatusEnum
```
CREATED | STARTED | FINISHED | ANALYZED | CANCELED | COMPLETED
```
Transitions are not strictly forward-only — e.g., ANALYZED can return to FINISHED if rejected. Full history tracked in `OrderStatusEntity`.

### Order.OrderEntity
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
updated_at: TIMESTAMPTZ[3]
deleted_at: NULL | TIMESTAMPTZ[3]
area_id: Project.AreaEntity(id)
contract_id: NULL | Commercial.ContractEntity(id)
description: NULL | TEXT
```
Current status derived from latest record in `OrderStatusEntity` (not stored directly on entity).

### Order.OrderStatusEntity (status history)
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
order_id: Order.OrderEntity(id)
status: Order.OrderStatusEnum
user_id: Identity.UserEntity(id)
notes: NULL | TEXT
```
Append-only. Current status = last record ordered by `created_at`. Enables full audit trail and status reversion.

### Order.OrderRecordEntity (service record)
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
updated_at: TIMESTAMPTZ[3]
deleted_at: NULL | TIMESTAMPTZ[3]
order_id: Order.OrderEntity(id)
performed_by_person_id: People.PersonEntity(id)
performed_at: TIMESTAMPTZ[3]
description: TEXT
```

### Order.OrderRecordItemEntity (executed resources)
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
order_record_id: Order.OrderRecordEntity(id)
contract_item_id: Commercial.ContractItemEntity(id)
qty: NUMERIC
notes: NULL | TEXT
```
References `ContractItemEntity` (not `ResourceEntity` directly) — preserves historical price and unit per contract.

### Order.OrderRecordMediaEntity
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
order_record_id: Order.OrderRecordEntity(id)
media_id: Shared.MediaEntity(id)
```
Supports all mime types defined in `Shared.MediaMimeTypeEnum` (photos, videos, PDFs, etc).

### Order.OrderRecordCommentEntity (threaded)
```
id: UUIDv7
created_at: TIMESTAMPTZ[3]
updated_at: TIMESTAMPTZ[3]
deleted_at: NULL | TIMESTAMPTZ[3]
order_record_id: Order.OrderRecordEntity(id)
comment_id_parent: NULL | Order.OrderRecordCommentEntity(id)
user_id: Identity.UserEntity(id)
body: TEXT
```
Threaded via `comment_id_parent` (same recursive naming convention).

## Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Resource ↔ Contract relationship | Catalog + snapshot (Option C) | Reusable catalog + immutable contract item for historical accuracy |
| CostCenter/Department on Project | Required, 1:1 each | Prevents split cost attribution and dual management |
| Org defaults | Auto-created on org creation | Guarantees project FKs always resolve |
| Order current status | Derived from latest `OrderStatusEntity` | Enables transitions in any direction with full audit trail |
| OrderRecordItem references | `ContractItemEntity` not `ResourceEntity` | Preserves historical price/unit per contract |
| Recursive key naming | `{entity_name}_id_parent` | Consistent convention across all recursive entities |
