import {
  ArrayAttribute,
  BooleanAttribute,
  CreateDateAttribute,
  DeleteDateAttribute,
  DynamoDocument,
  DynamoTable,
  NestedAttribute,
  NumberAttribute,
  StringAttribute,
  UpdateDateAttribute,
} from '#/index';

@DynamoDocument()
export class AddressDoc {
  @StringAttribute()
  street!: string;

  @StringAttribute()
  city!: string;
}

@DynamoTable('users')
export class UserTable {
  @StringAttribute({hashKey: true, required: true})
  id!: string;

  @StringAttribute({required: true, minLength: 2})
  name!: string;

  @NumberAttribute({required: true, min: 0})
  age!: number;

  @BooleanAttribute('is_active', {default: false})
  isActive!: boolean;

  @NestedAttribute(() => AddressDoc)
  address?: AddressDoc;

  @ArrayAttribute(() => String, {default: () => []})
  hobbies!: string[];

  @CreateDateAttribute('created_at')
  createdAt!: Date;

  @UpdateDateAttribute('updated_at')
  updatedAt!: Date;

  @DeleteDateAttribute('deleted_at')
  deletedAt!: Date | null;
}

@DynamoTable('orders')
export class OrderTable {
  @StringAttribute({hashKey: true, required: true})
  userId!: string;

  @StringAttribute({rangeKey: true, required: true})
  orderId!: string;

  @StringAttribute({required: true})
  product!: string;

  @NumberAttribute({default: 1})
  quantity!: number;
}

// ─── Fixtures for nested timestamp tests ──────────────────────────────────────

@DynamoDocument()
export class AuditedLineItem {
  @StringAttribute()
  sku!: string;

  @NumberAttribute()
  qty!: number;

  @CreateDateAttribute('created_at')
  createdAt!: Date;

  @UpdateDateAttribute('updated_at')
  updatedAt!: Date;
}

@DynamoDocument()
export class AuditedAddress {
  @StringAttribute()
  street!: string;

  @CreateDateAttribute('created_at')
  createdAt!: Date;

  @UpdateDateAttribute('updated_at')
  updatedAt!: Date;
}

@DynamoTable('audited_orders')
export class AuditedOrderTable {
  @StringAttribute({hashKey: true, required: true})
  id!: string;

  @NestedAttribute(() => AuditedAddress)
  address?: AuditedAddress;

  @ArrayAttribute(() => AuditedLineItem, {default: () => []})
  items!: AuditedLineItem[];

  @CreateDateAttribute('created_at')
  createdAt!: Date;

  @UpdateDateAttribute('updated_at')
  updatedAt!: Date;
}
