import type {StoredAttributeMeta} from '#/types';
import {addPendingAttribute} from './metadata.registry';

/**
 * Marks a property as the DynamoDB hash (partition) key.
 *
 * @example
 * ＠HashKey()
 * id: string;
 */
export function HashKey(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = String(propertyKey);
    addPendingAttribute(
      target.constructor as object,
      {
        propertyKey: key,
        attributeName: key,
        kind: 'string',
        isHashKey: true,
        isRangeKey: false,
        options: {required: true},
      } as StoredAttributeMeta
    );
  };
}

/**
 * Marks a property as the DynamoDB range (sort) key.
 *
 * @example
 * ＠RangeKey()
 * createdAt: string;
 */
export function RangeKey(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = String(propertyKey);
    addPendingAttribute(
      target.constructor as object,
      {
        propertyKey: key,
        attributeName: key,
        kind: 'string',
        isHashKey: false,
        isRangeKey: true,
        options: {required: true},
      } as StoredAttributeMeta
    );
  };
}
