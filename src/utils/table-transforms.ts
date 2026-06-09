import {getDocumentMeta, getTableMeta} from '#/decorators/metadata.registry';
import {serializeDate} from '#/schema';
import type {StoredAttributeMeta} from '#/types';

function isDateKind(kind: string): boolean {
  return kind === 'date' || kind === 'createDate' || kind === 'updateDate' || kind === 'deleteDate';
}

function serializeDoc(attrs: StoredAttributeMeta[], source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attr of attrs) {
    const v = source[attr.propertyKey];
    if (isDateKind(attr.kind)) {
      out[attr.attributeName] = v instanceof Date ? serializeDate(v, attr.timestampType as 'iso' | 'epoch' | 'ttl') : v;
    } else if (attr.kind === 'nested' && attr.typeRef) {
      if (v !== null && v !== undefined) {
        const meta = getDocumentMeta(attr.typeRef());
        out[attr.attributeName] = meta ? serializeDoc(meta.attributes, v as Record<string, unknown>) : v;
      } else {
        out[attr.attributeName] = v;
      }
    } else if (attr.kind === 'array' && attr.typeRef) {
      if (Array.isArray(v)) {
        const meta = getDocumentMeta(attr.typeRef());
        out[attr.attributeName] = meta
          ? v.map(item =>
              item !== null && item !== undefined
                ? serializeDoc(meta.attributes, item as Record<string, unknown>)
                : item
            )
          : v;
      } else {
        out[attr.attributeName] = v;
      }
    } else {
      out[attr.attributeName] = v;
    }
  }
  return out;
}

function parseDoc(attrs: StoredAttributeMeta[], raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {...raw};
  for (const attr of attrs) {
    const v = raw[attr.attributeName];
    if (attr.attributeName !== attr.propertyKey) {
      delete out[attr.attributeName];
    }
    if (isDateKind(attr.kind)) {
      if (v === null || v === undefined) {
        out[attr.propertyKey] = v;
      } else {
        const fmt = attr.timestampType as 'iso' | 'epoch' | 'ttl';
        out[attr.propertyKey] =
          fmt === 'iso'
            ? new Date(v as string)
            : fmt === 'ttl'
              ? new Date((v as number) * 1000)
              : new Date(v as number);
      }
    } else if (attr.kind === 'nested' && attr.typeRef) {
      if (v !== null && v !== undefined) {
        const meta = getDocumentMeta(attr.typeRef());
        out[attr.propertyKey] = meta ? parseDoc(meta.attributes, v as Record<string, unknown>) : v;
      } else {
        out[attr.propertyKey] = v;
      }
    } else if (attr.kind === 'array' && attr.typeRef) {
      if (Array.isArray(v)) {
        const meta = getDocumentMeta(attr.typeRef());
        out[attr.propertyKey] = meta
          ? v.map(item =>
              item !== null && item !== undefined ? parseDoc(meta.attributes, item as Record<string, unknown>) : item
            )
          : v;
      } else {
        out[attr.propertyKey] = v;
      }
    } else {
      out[attr.propertyKey] = v;
    }
  }
  // remove explicitly-undefined keys (absent in DynamoDB = absent in result)
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) {
      delete out[key];
    }
  }
  return out;
}

export function serializeDynamoTableItem<T extends object>(instance: T): Record<string, unknown> {
  const entityClass = instance.constructor as new () => T;
  const meta = getTableMeta(entityClass);
  if (!meta) {
    throw new Error(`[dynamoose-typed] "${entityClass.name}" is missing the @DynamoTable decorator.`);
  }
  const source = instance as unknown as Record<string, unknown>;
  const knownKeys = new Set([...meta.attributes.map(a => a.propertyKey), ...meta.attributes.map(a => a.attributeName)]);
  const unknowns: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (!knownKeys.has(k)) {
      unknowns[k] = v;
    }
  }
  return {...unknowns, ...serializeDoc(meta.attributes, source)};
}

export function parseDynamoTableItem<T extends object>(entityClass: new () => T, raw: Record<string, unknown>): T {
  const meta = getTableMeta(entityClass);
  if (!meta) {
    throw new Error(`[dynamoose-typed] "${entityClass.name}" is missing the @DynamoTable decorator.`);
  }
  return Object.assign(new entityClass(), parseDoc(meta.attributes, raw));
}
