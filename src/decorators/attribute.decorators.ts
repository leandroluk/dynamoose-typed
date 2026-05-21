import type {
  AnyRecord,
  ArrayAttributeOptions,
  BooleanAttributeOptions,
  DateAttributeOptions,
  LazyType,
  NestedAttributeOptions,
  NumberAttributeOptions,
  SetAttributeOptions,
  StoredAttributeMeta,
  StringAttributeOptions,
  TimestampOptions,
  VersionAttributeOptions,
} from '#/types';
import {addPendingAttribute} from './metadata.registry';

/**
 * Registers an attribute with the metadata registry.
 */
function register(
  target: object,
  propertyKey: string | symbol,
  partial: Omit<StoredAttributeMeta, 'propertyKey' | 'attributeName'> & {attributeName?: string}
): void {
  const key = String(propertyKey);
  addPendingAttribute(
    target.constructor as object,
    {
      ...partial,
      propertyKey: key,
      attributeName: partial.attributeName ?? key, // must come after spread
    } as StoredAttributeMeta
  );
}

/**
 * Declares a property as a DynamoDB attribute.
 *
 * @example
 * ＠Attribute({ type: String, required: true })
 * email: string;
 */
export function Attribute(options: AnyRecord): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    register(target, propertyKey, {
      kind: 'string',
      attributeName: options['alias'] as string | undefined,
      options,
    });
  };
}

/**
 * @example
 * ＠StringAttribute({ hashKey: true, default: crypto.randomUUID, trim: true })
 * id!: string;
 *
 * ＠StringAttribute('alias_name', { required: true, minLength: 3 })
 * name!: string;
 */
export function StringAttribute(
  aliasOrOptions?: string | StringAttributeOptions,
  opts?: StringAttributeOptions
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const alias = typeof aliasOrOptions === 'string' ? aliasOrOptions : undefined;
    const options = (typeof aliasOrOptions === 'object' ? aliasOrOptions : opts) ?? {};
    const isHashKey = options.hashKey ?? false;
    const isRangeKey = options.rangeKey ?? options.sortKey ?? false;
    register(target, propertyKey, {
      kind: 'string',
      attributeName: alias,
      options,
      isHashKey,
      isRangeKey,
    });
  };
}

/**
 * @example
 * ＠NumberAttribute({ required: true, min: 18, max: 120 })
 * age!: number;
 */
export function NumberAttribute(
  aliasOrOptions?: string | NumberAttributeOptions,
  options?: NumberAttributeOptions
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const alias = typeof aliasOrOptions === 'string' ? aliasOrOptions : undefined;
    const currentOptions = (typeof aliasOrOptions === 'object' ? aliasOrOptions : options) ?? {};
    register(target, propertyKey, {
      kind: 'number',
      attributeName: alias,
      options: currentOptions,
      isHashKey: currentOptions.hashKey ?? false,
      isRangeKey: currentOptions.rangeKey ?? false,
    });
  };
}

/**
 * @example
 * ＠BooleanAttribute('is_active', { default: false })
 * isActive!: boolean;
 */
export function BooleanAttribute(
  aliasOrOptions?: string | BooleanAttributeOptions,
  options?: BooleanAttributeOptions
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const alias = typeof aliasOrOptions === 'string' ? aliasOrOptions : undefined;
    const currentOptions = (typeof aliasOrOptions === 'object' ? aliasOrOptions : options) ?? {};
    register(target, propertyKey, {kind: 'boolean', attributeName: alias, options: currentOptions});
  };
}

/**
 * @example
 * ＠DateAttribute('start_date', { format: 'iso' })
 * startDate!: Date;
 *
 * ＠DateAttribute('expires_at', { ttl: true })
 * expiresAt!: Date;
 */
export function DateAttribute(
  aliasOrOptions?: string | DateAttributeOptions,
  options?: DateAttributeOptions
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const alias = typeof aliasOrOptions === 'string' ? aliasOrOptions : undefined;
    const currentOptions = (typeof aliasOrOptions === 'object' ? aliasOrOptions : options) ?? {};
    const isTtl = (currentOptions as {ttl?: boolean}).ttl === true;
    const timestampType = isTtl
      ? 'ttl'
      : (((currentOptions as {format?: string}).format as 'iso' | 'epoch' | undefined) ?? 'epoch');
    register(target, propertyKey, {
      kind: 'date',
      attributeName: alias,
      options: currentOptions,
      timestampType,
    });
  };
}

/**
 * Auto-set to current date on insert. Never updated after creation.
 *
 * @example
 * ＠CreateDateAttribute('created_at', { format: 'iso' })
 * createdAt!: Date;
 */
export function CreateDateAttribute(
  aliasOrOptions?: string | TimestampOptions,
  options?: TimestampOptions
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const alias = typeof aliasOrOptions === 'string' ? aliasOrOptions : undefined;
    const currentOptions = (typeof aliasOrOptions === 'object' ? aliasOrOptions : options) ?? {};
    register(target, propertyKey, {
      kind: 'createDate',
      attributeName: alias,
      options: currentOptions,
      timestampType: currentOptions.format ?? 'epoch',
    });
  };
}

/**
 * Auto-set to current date on every save/update.
 *
 * @example
 * ＠UpdateDateAttribute('updated_at', { format: 'epoch' })
 * updatedAt!: Date;
 */
export function UpdateDateAttribute(
  aliasOrOptions?: string | TimestampOptions,
  options?: TimestampOptions
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const alias = typeof aliasOrOptions === 'string' ? aliasOrOptions : undefined;
    const currentOptions = (typeof aliasOrOptions === 'object' ? aliasOrOptions : options) ?? {};
    register(target, propertyKey, {
      kind: 'updateDate',
      attributeName: alias,
      options: currentOptions,
      timestampType: currentOptions.format ?? 'epoch',
    });
  };
}

/**
 * Soft-delete marker. Set on `delete()`, null on `restore()`.
 * When present on a table class, `delete()` becomes a soft delete by default.
 *
 * @example
 * ＠DeleteDateAttribute('deleted_at')
 * deletedAt!: Date | null;
 */
export function DeleteDateAttribute(
  aliasOrOptions?: string | TimestampOptions,
  options?: TimestampOptions
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const alias = typeof aliasOrOptions === 'string' ? aliasOrOptions : undefined;
    const currentOptions = (typeof aliasOrOptions === 'object' ? aliasOrOptions : options) ?? {};
    register(target, propertyKey, {
      kind: 'deleteDate',
      attributeName: alias,
      options: currentOptions,
      timestampType: currentOptions.format ?? 'epoch',
    });
  };
}

/**
 * Embeds a @DynamoDocument class as a nested object attribute.
 *
 * @example
 * ＠NestedAttribute(() => AddressDocument)
 * address!: AddressDocument;
 */
export function NestedAttribute(typeRef: LazyType, options?: NestedAttributeOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    register(target, propertyKey, {
      kind: 'nested',
      options: options ?? {},
      typeRef,
    });
  };
}

/**
 * Array of primitives or @DynamoDocument instances.
 *
 * @example
 * ＠ArrayAttribute(() => String, { default: () => [] })
 * hobbies!: string[];
 *
 * ＠ArrayAttribute(() => ContractDocument)
 * contracts!: ContractDocument[];
 */
export function ArrayAttribute(typeRef: LazyType, options?: ArrayAttributeOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    register(target, propertyKey, {
      kind: 'array',
      options: options ?? {},
      typeRef,
    });
  };
}

/**
 * DynamoDB Set (SS / NS) — must be a Set of strings or numbers.
 *
 * @example
 * ＠SetAttribute(() => String, { default: () => new Set() })
 * roles!: Set<string>;
 */
export function SetAttribute(typeRef: LazyType, options?: SetAttributeOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    register(target, propertyKey, {
      kind: 'set',
      options: options ?? {},
      typeRef,
    });
  };
}

/**
 * Optimistic-locking version counter. Auto-increments on every `update()`.
 * Condition `version = expected` is applied; throws `OptimisticLockError` on conflict.
 *
 * @example
 * ＠VersionAttribute()
 * version!: number;
 *
 * ＠VersionAttribute('v')
 * version!: number;
 */
export function VersionAttribute(aliasOrOptions?: string | VersionAttributeOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const alias = typeof aliasOrOptions === 'string' ? aliasOrOptions : aliasOrOptions?.alias;
    register(target, propertyKey, {
      kind: 'version',
      attributeName: alias,
      options: {},
    });
  };
}
