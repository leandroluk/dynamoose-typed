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
  VersionAttribute,
} from './decorators/attribute.decorators';

export {OptimisticLockError} from './errors';

export {DynamoDB} from '@aws-sdk/client-dynamodb';

export {DataSource} from './data-source/data-source';
export type {DataSourceOptions} from './data-source/data-source';

export {Repository} from './repository/repository';
export {EntityManager} from './manager/entity-manager';

export type {
  DateFormat,
  FilterCondition,
  FindOptions,
  CountOptions,
  PaginatedResult,
  Projected,
  SelectMap,
  SortKeyCondition,
  TableHooks,
  TimestampOptions,
  TransformOptions,
  WriteOptions,
} from './types/core.types';

export type {TableOptions, DocumentOptions, ThroughputOptions} from './types/meta.types';

export type {
  StringAttributeOptions,
  NumberAttributeOptions,
  BooleanAttributeOptions,
  DateAttributeOptions,
  NestedAttributeOptions,
  ArrayAttributeOptions,
  SetAttributeOptions,
  VersionAttributeOptions,
  IndexOptions,
} from './types/attribute.types';
