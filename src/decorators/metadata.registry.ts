import type {DocumentMeta, StoredAttributeMeta, TableMeta} from '#/types';

const tableMetaMap = new WeakMap<object, TableMeta>();
const documentMetaMap = new WeakMap<object, DocumentMeta>();
// pending attributes before class decorator runs
const pendingAttributesMap = new WeakMap<object, StoredAttributeMeta[]>();

export function setTableMeta(target: object, meta: Omit<TableMeta, 'attributes'>): void {
  const pending = pendingAttributesMap.get(target) ?? [];
  const hashAttr = pending.find(a => a.isHashKey);
  const rangeAttr = pending.find(a => a.isRangeKey);

  const full: TableMeta = {
    ...meta,
    attributes: pending,
    hashKey: hashAttr?.attributeName,
    rangeKey: rangeAttr?.attributeName,
    deleteDateKey: pending.find(a => a.kind === 'deleteDate')?.propertyKey,
  };

  tableMetaMap.set(target, full);
  pendingAttributesMap.delete(target);
}

export function getTableMeta(target: object): TableMeta | undefined {
  return tableMetaMap.get(target);
}

export function setDocumentMeta(target: object, options: DocumentMeta['options']): void {
  const pending = pendingAttributesMap.get(target) ?? [];
  documentMetaMap.set(target, {options, attributes: pending});
  pendingAttributesMap.delete(target);
}

export function getDocumentMeta(target: object): DocumentMeta | undefined {
  return documentMetaMap.get(target);
}

export function addPendingAttribute(target: object, meta: StoredAttributeMeta): void {
  const existing = pendingAttributesMap.get(target) ?? [];
  pendingAttributesMap.set(target, [...existing, meta]);
}
