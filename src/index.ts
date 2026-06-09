export {DynamoDB} from '@aws-sdk/client-dynamodb';
export * from './data-source';
export * from './decorators';
export * from './errors';
export * from './manager';
export * from './repository';
export * from './types';
export {parseDynamoTableItem, serializeDynamoTableItem} from './utils/table-transforms';
