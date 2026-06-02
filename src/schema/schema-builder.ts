import {getDocumentMeta, getTableMeta} from '#/decorators/metadata.registry';
import type {DocumentMeta, IndexOptions, StoredAttributeMeta} from '#/types';

function fmtToStorageType(fmt: 'iso' | 'epoch' | 'ttl' | undefined): StringConstructor | NumberConstructor {
  return fmt === 'iso' ? String : Number;
}

/**
 * Converts an `index` option value into the Dynamoose-compatible index definition.
 * Resolves TypeScript property name rangeKey to DynamoDB attribute name via aliasMap.
 */
function buildIndexEntry(
  indexOpt: boolean | IndexOptions,
  aliasMap: Record<string, string>
): true | Record<string, unknown> {
  if (typeof indexOpt === 'boolean') {
    return true;
  }
  const idx = indexOpt;
  const resolvedRangeKey = idx.rangeKey ? (aliasMap[idx.rangeKey] ?? idx.rangeKey) : undefined;
  const indexDef: Record<string, unknown> = {};
  if (idx.name !== undefined) {
    indexDef['name'] = idx.name;
  }
  if (resolvedRangeKey !== undefined) {
    indexDef['rangeKey'] = resolvedRangeKey;
  }
  if (idx.project !== undefined) {
    indexDef['project'] = idx.project;
  }
  return indexDef;
}

/**
 * Recursively build the raw schema definition for a document/table class.
 */
function buildDefinition(attributes: StoredAttributeMeta[], aliasMap: Record<string, string>): Record<string, unknown> {
  const def: Record<string, unknown> = {};

  for (const attr of attributes) {
    const key = attr.attributeName;
    const opts = attr.options;

    switch (attr.kind) {
      case 'string': {
        const entry: Record<string, unknown> = {
          type: String,
          required: opts['required'],
          default: opts['default'],
          validate: opts['validate'],
          hashKey: attr.isHashKey || undefined,
          rangeKey: attr.isRangeKey || undefined,
        };
        if (opts['enum']) {
          entry['enum'] = opts['enum'];
        }
        if (opts['trim']) {
          entry['trim'] = true;
        }
        if (opts['lowercase']) {
          entry['lowercase'] = true;
        }
        if (opts['uppercase']) {
          entry['uppercase'] = true;
        }
        if (
          (opts['minLength'] !== null && opts['minLength'] !== undefined) ||
          (opts['maxLength'] !== null && opts['maxLength'] !== undefined)
        ) {
          entry['validate'] = (v: unknown): boolean => {
            const s = String(v);
            if (
              opts['minLength'] !== null &&
              opts['minLength'] !== undefined &&
              s.length < (opts['minLength'] as number)
            ) {
              return false;
            }
            if (
              opts['maxLength'] !== null &&
              opts['maxLength'] !== undefined &&
              s.length > (opts['maxLength'] as number)
            ) {
              return false;
            }
            return true;
          };
        }
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
        }
        if (opts['index']) {
          entry['index'] = buildIndexEntry(opts['index'] as boolean | IndexOptions, aliasMap);
        }
        def[key] = entry;
        break;
      }

      case 'number': {
        const entry: Record<string, unknown> = {
          type: Number,
          required: opts['required'],
          default: opts['default'],
          hashKey: attr.isHashKey || undefined,
          rangeKey: attr.isRangeKey || undefined,
        };
        if (
          (opts['min'] !== null && opts['min'] !== undefined) ||
          (opts['max'] !== null && opts['max'] !== undefined)
        ) {
          entry['validate'] = (v: unknown): boolean => {
            const n = Number(v);
            if (opts['min'] !== null && opts['min'] !== undefined && n < (opts['min'] as number)) {
              return false;
            }
            if (opts['max'] !== null && opts['max'] !== undefined && n > (opts['max'] as number)) {
              return false;
            }
            return true;
          };
        }
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
        }
        if (opts['index']) {
          entry['index'] = buildIndexEntry(opts['index'] as boolean | IndexOptions, aliasMap);
        }
        def[key] = entry;
        break;
      }

      case 'boolean': {
        const entry: Record<string, unknown> = {
          type: Boolean,
          required: opts['required'],
          default: opts['default'],
        };
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
        }
        if (opts['index']) {
          entry['index'] = buildIndexEntry(opts['index'] as boolean | IndexOptions, aliasMap);
        }
        def[key] = entry;
        break;
      }

      case 'date': {
        const isTtl = attr.timestampType === 'ttl';
        const fmt = attr.timestampType;
        const rawDefault = opts['default'];
        const wrappedDefault = rawDefault
          ? (): string | number => {
              const val = typeof rawDefault === 'function' ? (rawDefault as () => unknown)() : rawDefault;
              if (val instanceof Date) {
                return serializeDate(val, fmt as 'iso' | 'epoch' | 'ttl');
              }
              return val as string | number;
            }
          : undefined;
        const entry: Record<string, unknown> = {
          type: fmtToStorageType(fmt),
          required: opts['required'],
          default: wrappedDefault,
        };
        if (isTtl) {
          entry['get'] = opts['get'] ?? ((n: number): Date => new Date(n * 1000));
          entry['set'] = opts['set'] ?? ((d: Date): number => Math.floor(d.getTime() / 1000));
        } else {
          if (opts['get']) {
            entry['get'] = opts['get'];
          }
          if (opts['set']) {
            entry['set'] = opts['set'];
          }
        }
        if (opts['index']) {
          entry['index'] = buildIndexEntry(opts['index'] as boolean | IndexOptions, aliasMap);
        }
        def[key] = entry;
        break;
      }

      case 'createDate':
      case 'updateDate':
      case 'deleteDate': {
        const fmt = attr.timestampType as 'iso' | 'epoch';
        const entry: Record<string, unknown> = {
          type: fmtToStorageType(fmt),
          required: attr.kind === 'deleteDate' ? false : opts['required'],
          default:
            attr.kind === 'createDate' || attr.kind === 'updateDate'
              ? (): string | number => serializeDate(new Date(), fmt)
              : opts['default'],
        };
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
        }
        if (opts['index']) {
          entry['index'] = buildIndexEntry(opts['index'] as boolean | IndexOptions, aliasMap);
        }
        def[key] = entry;
        break;
      }

      case 'nested': {
        if (!attr.typeRef) {
          break;
        }
        const NestedClass = attr.typeRef();
        const nestedMeta: DocumentMeta | undefined = getDocumentMeta(NestedClass);
        const nestedAttrs = nestedMeta?.attributes ?? [];
        const entry: Record<string, unknown> = {
          type: Object,
          required: opts['required'],
          default: opts['default'],
          schema: buildDefinition(nestedAttrs, aliasMap),
        };
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
        }
        if (opts['index']) {
          entry['index'] = buildIndexEntry(opts['index'] as boolean | IndexOptions, aliasMap);
        }
        def[key] = entry;
        break;
      }

      case 'array': {
        if (!attr.typeRef) {
          break;
        }
        const ElemClass = attr.typeRef();
        const isDocument = !!getDocumentMeta(ElemClass);
        const entry: Record<string, unknown> = {
          type: Array,
          required: opts['required'],
          default: opts['default'],
          schema: isDocument
            ? [{type: Object, schema: buildDefinition(getDocumentMeta(ElemClass)!.attributes, aliasMap)}]
            : [{type: ElemClass}],
        };
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
        }
        if (opts['index']) {
          entry['index'] = buildIndexEntry(opts['index'] as boolean | IndexOptions, aliasMap);
        }
        def[key] = entry;
        break;
      }

      case 'set': {
        if (!attr.typeRef) {
          break;
        }
        const ElemClass = attr.typeRef();
        const entry: Record<string, unknown> = {
          type: Set,
          required: opts['required'],
          default: opts['default'],
          schema: [{type: ElemClass}],
        };
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
        }
        if (opts['index']) {
          entry['index'] = buildIndexEntry(opts['index'] as boolean | IndexOptions, aliasMap);
        }
        def[key] = entry;
        break;
      }

      case 'version': {
        def[key] = {type: Number, default: 0};
        break;
      }
    }

    // clean up undefined values
    if (def[key] && typeof def[key] === 'object') {
      def[key] = Object.fromEntries(
        Object.entries(def[key] as Record<string, unknown>).filter(([, v]) => v !== undefined)
      );
    }
  }

  return def;
}

export function serializeDate(date: Date, format: 'iso' | 'epoch' | 'ttl'): string | number {
  if (format === 'iso') {
    return date.toISOString();
  }
  if (format === 'ttl') {
    return Math.floor(date.getTime() / 1000);
  }
  return date.getTime();
}

export interface ResolvedSchema {
  /** The table name, as provided in the @DynamoTable decorator. */
  tableName: string;
  /** The raw schema definition to be passed to Dynamoose. */
  definition: Record<string, unknown>;
  /** Options to be passed to DynamooseSchema. */
  schemaOptions: {saveUnknown?: boolean | string[]};
  /** Options to be passed to DynamooseTable. */
  tableOptions: Record<string, unknown>;
  /** The hash key property name. */
  hashKey: string;
  /** The range key property name, if defined. */
  rangeKey?: string;
  /** The delete date property name, if defined. */
  deleteDateKey?: string;
  /** GSI name for the @DeleteDateAttribute sparse index, if `index: true` was set. */
  deleteDateIndexName?: string;
  /** Property name of the @DateAttribute({ ttl: true }) field, if any. */
  ttlKey?: string;
  /** Property name of the @VersionAttribute field, if any. */
  versionKey?: string;
  /** Attribute name (after alias resolution) of the @VersionAttribute field, if any. */
  versionAttrName?: string;
  /** Property → attribute name mapping for alias resolution. */
  aliasMap: Record<string, string>;
  /** Attribute name → property key (reverse). */
  reverseAliasMap: Record<string, string>;
}

/**
 * Reads all decorator metadata from a @DynamoTable class
 * and produces a plain dynamoose-compatible schema definition.
 */
export function resolveTableSchema(entityClass: new () => unknown): ResolvedSchema {
  const meta = getTableMeta(entityClass);

  if (!meta) {
    throw new Error(`[dynamoose-typed] "${entityClass.name}" is missing the @DynamoTable decorator.`);
  }

  if (!meta.hashKey) {
    throw new Error(
      `[dynamoose-typed] "${entityClass.name}" must have a @StringAttribute or @NumberAttribute with hashKey: true.`
    );
  }

  // Build alias maps first (needed by buildDefinition for index rangeKey resolution)
  const aliasMap: Record<string, string> = {};
  const reverseAliasMap: Record<string, string> = {};
  for (const attr of meta.attributes) {
    aliasMap[attr.propertyKey] = attr.attributeName;
    reverseAliasMap[attr.attributeName] = attr.propertyKey;
  }

  const definition = buildDefinition(meta.attributes, aliasMap);

  const {_hooks, ...tableOptions} = meta.options as Record<string, unknown>;

  const deleteDateAttr = meta.attributes.find(a => a.kind === 'deleteDate');
  const deleteDateIndexName =
    deleteDateAttr?.options['index'] === true ? `${deleteDateAttr.attributeName}GlobalIndex` : undefined;

  const ttlAttr = meta.attributes.find(a => a.kind === 'date' && a.timestampType === 'ttl');
  const ttlKey = ttlAttr?.propertyKey;
  if (ttlAttr) {
    tableOptions['expires'] = {attribute: ttlAttr.attributeName};
  }

  const versionAttr = meta.attributes.find(a => a.kind === 'version');
  const versionKey = versionAttr?.propertyKey;
  const versionAttrName = versionAttr?.attributeName;

  return {
    tableName: meta.tableName,
    definition,
    schemaOptions: {
      saveUnknown: (meta.options as Record<string, unknown>)['saveUnknown'] as boolean | undefined,
    },
    tableOptions,
    hashKey: meta.hashKey,
    rangeKey: meta.rangeKey,
    deleteDateKey: meta.deleteDateKey,
    deleteDateIndexName,
    ttlKey,
    versionKey,
    versionAttrName,
    aliasMap,
    reverseAliasMap,
  };
}
