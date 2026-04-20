import type {DocumentOptions, TableOptions} from '#/types';
import {setDocumentMeta, setTableMeta} from './metadata.registry';

/**
 * Marks a class as a DynamoDB table entity.
 *
 * @example
 * ＠DynamoTable('users', { saveUnknown: true, hooks: { beforeInsert: ... } })
 * class UserTable { ... }
 */
export function DynamoTable<T = unknown>(tableName: string, options: TableOptions<T> = {}): ClassDecorator {
  return (target: object) => {
    setTableMeta(target, {tableName, options: options as TableOptions});
  };
}

/**
 * Marks a class as an embeddable nested document (no table of its own).
 *
 * @example
 * ＠DynamoDocument({ saveUnknown: true })
 * class AddressDocument { ... }
 */
export function DynamoDocument(options: DocumentOptions = {}): ClassDecorator {
  return (target: object) => {
    setDocumentMeta(target, options);
  };
}
