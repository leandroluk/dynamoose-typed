import {getDocumentMeta, getTableMeta} from '#/decorators/metadata.registry';
import type {DocumentMeta, StoredAttributeMeta} from '#/types';

function timestampStorageType(meta: StoredAttributeMeta): StringConstructor | NumberConstructor | DateConstructor {
  return (meta.timestampType as StringConstructor | NumberConstructor | DateConstructor | undefined) ?? Date;
}

/**
 * Recursively build the raw schema definition for a document/table class.
 */
function buildDefinition(attributes: StoredAttributeMeta[]): Record<string, unknown> {
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
        def[key] = entry;
        break;
      }

      case 'date':
      case 'createDate':
      case 'updateDate':
      case 'deleteDate': {
        const entry: Record<string, unknown> = {
          type: timestampStorageType(attr),
          required: attr.kind === 'deleteDate' ? false : opts['required'],
          default:
            attr.kind === 'createDate' || attr.kind === 'updateDate'
              ? (): string | number | Date => serializeDate(new Date(), timestampStorageType(attr))
              : opts['default'],
        };
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
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
          schema: buildDefinition(nestedAttrs),
        };
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
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
            ? [{type: Object, schema: buildDefinition(getDocumentMeta(ElemClass)!.attributes)}]
            : [{type: ElemClass}],
        };
        if (opts['get']) {
          entry['get'] = opts['get'];
        }
        if (opts['set']) {
          entry['set'] = opts['set'];
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
        def[key] = entry;
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

export function serializeDate(
  date: Date,
  type: StringConstructor | NumberConstructor | DateConstructor
): string | number | Date {
  if (type === String) {
    return date.toISOString();
  }
  if (type === Number) {
    return date.getTime();
  }
  return date;
}

export interface ResolvedSchema {
  tableName: string;
  definition: Record<string, unknown>;
  schemaOptions: {saveUnknown?: boolean | string[]};
  tableOptions: Record<string, unknown>;
  hashKey: string;
  rangeKey?: string;
  deleteDateKey?: string;
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

  const definition = buildDefinition(meta.attributes);

  // Build alias maps
  const aliasMap: Record<string, string> = {};
  const reverseAliasMap: Record<string, string> = {};
  for (const attr of meta.attributes) {
    aliasMap[attr.propertyKey] = attr.attributeName;
    reverseAliasMap[attr.attributeName] = attr.propertyKey;
  }

  const {_hooks, ...tableOptions} = meta.options as Record<string, unknown>;

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
    aliasMap,
    reverseAliasMap,
  };
}
