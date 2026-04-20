export {DynamoTable, DynamoDocument} from './decorators/class.decorators';
export {getTableMeta, getDocumentMeta} from './decorators/metadata.registry';

export {
  Attribute,
  StringAttribute,
  NumberAttribute,
  BooleanAttribute,
  DateAttribute,
  CreateDateAttribute,
  UpdateDateAttribute,
  DeleteDateAttribute,
  NestedAttribute,
  ArrayAttribute,
  SetAttribute,
} from './decorators/attribute.decorators';

export {HashKey, RangeKey} from './decorators/key.decorators';

export {DataSource} from './data-source/data-source';
export type {DataSourceOptions} from './data-source/data-source';

export {Repository} from './repository/repository';
export {EntityManager} from './manager/entity-manager';

export type {
  FindOptions,
  CountOptions,
  PaginatedResult,
  TableHooks,
  TimestampOptions,
  TimestampStorageType,
  TransformOptions,
} from './types/core.types';

export type {TableOptions, DocumentOptions} from './types/meta.types';

export type {
  StringAttributeOptions,
  NumberAttributeOptions,
  BooleanAttributeOptions,
  DateAttributeOptions,
  NestedAttributeOptions,
  ArrayAttributeOptions,
  SetAttributeOptions,
} from './types/attribute.types';
