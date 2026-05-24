import {
  ArrayAttribute,
  BooleanAttribute,
  CreateDateAttribute,
  DateAttribute,
  DynamoDocument,
  DynamoTable,
  NestedAttribute,
  NumberAttribute,
  SetAttribute,
  StringAttribute,
} from '#';
import {resolveTableSchema, serializeDate} from '#/schema';
import {describe, expect, it} from 'vitest';
import {OrderTable, UserTable} from './fixtures';

describe('resolveTableSchema', () => {
  it('returns correct tableName', () => {
    const schema = resolveTableSchema(UserTable);
    expect(schema.tableName).toBe('users');
  });

  describe('string attribute options', () => {
    it('supports enum, trim, lowercase, uppercase', () => {
      @DynamoTable('string-opts')
      class StringOptsTable {
        @StringAttribute({hashKey: true}) id!: string;
        @StringAttribute({enum: ['A', 'B'], trim: true, lowercase: true, uppercase: true})
        field!: string;
      }
      const schema = resolveTableSchema(StringOptsTable);
      const field = schema.definition['field'] as {
        enum: string[];
        trim: boolean;
        lowercase: boolean;
        uppercase: boolean;
      };
      expect(field.enum).toEqual(['A', 'B']);
      expect(field.trim).toBe(true);
      expect(field.lowercase).toBe(true);
      expect(field.uppercase).toBe(true);
    });

    it('supports minLength and maxLength validation', () => {
      @DynamoTable('string-val')
      class StringValTable {
        @StringAttribute({hashKey: true}) id!: string;
        @StringAttribute({minLength: 5, maxLength: 10})
        field!: string;
      }
      const schema = resolveTableSchema(StringValTable);
      const field = schema.definition['field'] as {validate: (value: string) => boolean};
      expect(field.validate).toBeDefined();
      expect(field.validate('abc')).toBe(false);
      expect(field.validate('abcdef')).toBe(true);
      expect(field.validate('abcdefghijkl')).toBe(false);
    });
  });

  describe('number attribute options', () => {
    it('supports min and max validation', () => {
      @DynamoTable('num-val')
      class NumValTable {
        @StringAttribute({hashKey: true}) id!: string;
        @NumberAttribute({min: 10, max: 20})
        field!: number;
      }
      const schema = resolveTableSchema(NumValTable);
      const field = schema.definition['field'] as {validate: (value: number) => boolean};
      expect(field.validate).toBeDefined();
      expect(field.validate(5)).toBe(false);
      expect(field.validate(15)).toBe(true);
      expect(field.validate(25)).toBe(false);
    });
  });

  describe('serializeDate', () => {
    it('serializes to ISO string', () => {
      const now = new Date();
      expect(serializeDate(now, 'iso')).toBe(now.toISOString());
    });

    it('serializes to epoch milliseconds', () => {
      const now = new Date();
      expect(serializeDate(now, 'epoch')).toBe(now.getTime());
    });

    it('serializes to TTL epoch seconds', () => {
      const now = new Date();
      expect(serializeDate(now, 'ttl')).toBe(Math.floor(now.getTime() / 1000));
    });
  });

  describe('date attribute defaults', () => {
    it('applies default serialization for CreateDateAttribute', () => {
      @DynamoTable('date-defaults')
      class DateDefaultsTable {
        @StringAttribute({hashKey: true}) id!: string;
        @DateAttribute({format: 'epoch'}) date!: Date;
      }
      const schema = resolveTableSchema(DateDefaultsTable);
      const dateField = schema.definition['date'] as {type: never};
      expect(dateField.type).toBe(Number);
    });
  });

  describe('set and array attributes', () => {
    it('builds set definition', () => {
      @DynamoTable('set-table')
      class SetTable {
        @StringAttribute({hashKey: true}) id!: string;
        @SetAttribute(() => String) tags!: Set<string>;
      }
      const schema = resolveTableSchema(SetTable);
      expect(schema.definition['tags']).toEqual(
        expect.objectContaining({
          type: Set,
          schema: [{type: String}],
        })
      );
    });

    it('NumberAttribute with set transform includes set in entry', () => {
      const setFn = (v: number) => v * 2;
      @DynamoTable('num-set')
      class NumSetTable {
        @StringAttribute({hashKey: true}) id!: string;
        @NumberAttribute({set: setFn}) val!: number;
      }
      const schema = resolveTableSchema(NumSetTable);
      expect((schema.definition['val'] as Record<string, unknown>)['set']).toBe(setFn);
    });

    it('ArrayAttribute with set transform includes set in entry', () => {
      const setFn = (v: unknown[]) => v;
      @DynamoTable('arr-set')
      class ArrSetTable {
        @StringAttribute({hashKey: true}) id!: string;
        @ArrayAttribute(() => String, {set: setFn}) tags!: string[];
      }
      const schema = resolveTableSchema(ArrSetTable);
      expect((schema.definition['tags'] as Record<string, unknown>)['set']).toBe(setFn);
    });

    it('SetAttribute with set transform includes set in entry', () => {
      const setFn = (v: Set<unknown>) => v;
      @DynamoTable('set-set')
      class SetSetTable {
        @StringAttribute({hashKey: true}) id!: string;
        @SetAttribute(() => String, {set: setFn}) roles!: Set<string>;
      }
      const schema = resolveTableSchema(SetSetTable);
      expect((schema.definition['roles'] as Record<string, unknown>)['set']).toBe(setFn);
    });
  });

  describe('index option', () => {
    it('StringAttribute with index:true includes index in entry', () => {
      @DynamoTable('str-idx')
      class StrIdxTable {
        @StringAttribute({hashKey: true}) id!: string;
        @StringAttribute({index: true}) name!: string;
      }
      const schema = resolveTableSchema(StrIdxTable);
      expect((schema.definition['name'] as Record<string, unknown>)['index']).toBe(true);
    });

    it('NumberAttribute with index:true includes index in entry', () => {
      @DynamoTable('num-idx')
      class NumIdxTable {
        @StringAttribute({hashKey: true}) id!: string;
        @NumberAttribute({index: true}) score!: number;
      }
      const schema = resolveTableSchema(NumIdxTable);
      expect((schema.definition['score'] as Record<string, unknown>)['index']).toBe(true);
    });

    it('BooleanAttribute with index:true includes index in entry', () => {
      @DynamoTable('bool-idx')
      class BoolIdxTable {
        @StringAttribute({hashKey: true}) id!: string;
        @BooleanAttribute({index: true}) active!: boolean;
      }
      const schema = resolveTableSchema(BoolIdxTable);
      expect((schema.definition['active'] as Record<string, unknown>)['index']).toBe(true);
    });

    it('DateAttribute with index:true includes index in entry', () => {
      @DynamoTable('date-idx')
      class DateIdxTable {
        @StringAttribute({hashKey: true}) id!: string;
        @DateAttribute({index: true}) ts!: Date;
      }
      const schema = resolveTableSchema(DateIdxTable);
      expect((schema.definition['ts'] as Record<string, unknown>)['index']).toBe(true);
    });

    it('CreateDateAttribute with get transform includes get in entry', () => {
      const getFn = (v: Date) => v;
      @DynamoTable('cdate-get')
      class CdateGetTable {
        @StringAttribute({hashKey: true}) id!: string;
        @CreateDateAttribute({get: getFn}) createdAt!: Date;
      }
      const schema = resolveTableSchema(CdateGetTable);
      expect((schema.definition['createdAt'] as Record<string, unknown>)['get']).toBe(getFn);
    });

    it('CreateDateAttribute with set transform includes set in entry', () => {
      const setFn = (v: Date) => v;
      @DynamoTable('cdate-set')
      class CdateSetTable {
        @StringAttribute({hashKey: true}) id!: string;
        @CreateDateAttribute({set: setFn}) createdAt!: Date;
      }
      const schema = resolveTableSchema(CdateSetTable);
      expect((schema.definition['createdAt'] as Record<string, unknown>)['set']).toBe(setFn);
    });

    it('NestedAttribute with index:true includes index in entry', () => {
      @DynamoDocument()
      class AddrDoc {
        @StringAttribute() street!: string;
      }
      @DynamoTable('nested-idx')
      class NestedIdxTable {
        @StringAttribute({hashKey: true}) id!: string;
        @NestedAttribute(() => AddrDoc, {index: true}) addr!: AddrDoc;
      }
      const schema = resolveTableSchema(NestedIdxTable);
      expect((schema.definition['addr'] as Record<string, unknown>)['index']).toBe(true);
    });

    it('ArrayAttribute with index:true includes index in entry', () => {
      @DynamoTable('arr-idx')
      class ArrIdxTable {
        @StringAttribute({hashKey: true}) id!: string;
        @ArrayAttribute(() => String, {index: true}) tags!: string[];
      }
      const schema = resolveTableSchema(ArrIdxTable);
      expect((schema.definition['tags'] as Record<string, unknown>)['index']).toBe(true);
    });

    it('SetAttribute with index:true includes index in entry', () => {
      @DynamoTable('set-idx')
      class SetIdxTable {
        @StringAttribute({hashKey: true}) id!: string;
        @SetAttribute(() => String, {index: true}) roles!: Set<string>;
      }
      const schema = resolveTableSchema(SetIdxTable);
      expect((schema.definition['roles'] as Record<string, unknown>)['index']).toBe(true);
    });
  });

  describe('TTL attribute', () => {
    it('sets expires.attribute in tableOptions when @DateAttribute({ ttl: true }) is present', () => {
      @DynamoTable('ttl-table')
      class TtlTable {
        @StringAttribute({hashKey: true}) id!: string;
        @DateAttribute({ttl: true}) expiresAt!: Date;
      }
      const schema = resolveTableSchema(TtlTable);
      expect(schema.tableOptions['expires']).toEqual({attribute: 'expiresAt'});
      expect(schema.ttlKey).toBe('expiresAt');
    });

    it('TTL attribute stores default get/set functions that convert seconds↔Date', () => {
      @DynamoTable('ttl-fn-table')
      class TtlFnTable {
        @StringAttribute({hashKey: true}) id!: string;
        @DateAttribute({ttl: true}) expiresAt!: Date;
      }
      const schema = resolveTableSchema(TtlFnTable);
      const field = schema.definition['expiresAt'] as {get: (n: number) => Date; set: (d: Date) => number};
      const ts = 1000;
      expect(field.get(ts)).toEqual(new Date(ts * 1000));
      expect(field.set(new Date(ts * 1000))).toBe(ts);
    });

    it('TTL attribute with custom get/set uses provided functions', () => {
      const getFn = (n: number) => new Date(n * 1000);
      const setFn = (d: Date) => Math.floor(d.getTime() / 1000);
      @DynamoTable('ttl-custom-table')
      class TtlCustomTable {
        @StringAttribute({hashKey: true}) id!: string;
        @DateAttribute({ttl: true, get: getFn as never, set: setFn as never}) expiresAt!: Date;
      }
      const schema = resolveTableSchema(TtlCustomTable);
      const field = schema.definition['expiresAt'] as {get: unknown; set: unknown};
      expect(field.get).toBe(getFn);
      expect(field.set).toBe(setFn);
    });

    it('sets expires with alias when ttl attribute has an alias', () => {
      @DynamoTable('ttl-alias-table')
      class TtlAliasTable {
        @StringAttribute({hashKey: true}) id!: string;
        @DateAttribute('expires_at', {ttl: true}) expiresAt!: Date;
      }
      const schema = resolveTableSchema(TtlAliasTable);
      expect(schema.tableOptions['expires']).toEqual({attribute: 'expires_at'});
    });
  });

  it('sets hashKey', () => {
    const schema = resolveTableSchema(UserTable);
    expect(schema.hashKey).toBe('id');
  });

  it('sets rangeKey when present', () => {
    const schema = resolveTableSchema(OrderTable);
    expect(schema.rangeKey).toBe('orderId');
  });

  it('sets deleteDateKey when @DeleteDateAttribute is present', () => {
    const schema = resolveTableSchema(UserTable);
    expect(schema.deleteDateKey).toBe('deletedAt');
  });

  it('builds aliasMap for renamed attributes', () => {
    const schema = resolveTableSchema(UserTable);
    expect(schema.aliasMap['isActive']).toBe('is_active');
    expect(schema.aliasMap['createdAt']).toBe('created_at');
  });

  it('builds reverseAliasMap', () => {
    const schema = resolveTableSchema(UserTable);
    expect(schema.reverseAliasMap['is_active']).toBe('isActive');
  });

  it('includes all attributes in definition', () => {
    const schema = resolveTableSchema(UserTable);
    expect(schema.definition).toHaveProperty('id');
    expect(schema.definition).toHaveProperty('name');
    expect(schema.definition).toHaveProperty('age');
  });

  it('throws when @DynamoTable is missing', () => {
    class NotATable {}
    expect(() => resolveTableSchema(NotATable as never)).toThrow('@DynamoTable');
  });

  it('throws when no hashKey is declared', () => {
    @DynamoTable('no-key')
    class NoKey {
      @StringAttribute()
      name!: string;
    }
    expect(() => resolveTableSchema(NoKey)).toThrow('hashKey');
  });
});

describe('composite GSI (index as object)', () => {
  it('preserves index: true behavior unchanged', () => {
    @DynamoTable('gsi-bool')
    class GsiBoolTable {
      @StringAttribute({hashKey: true}) id!: string;
      @StringAttribute({index: true}) email!: string;
    }
    const schema = resolveTableSchema(GsiBoolTable);
    const field = schema.definition['email'] as {index: unknown};
    expect(field.index).toBe(true);
  });

  it('sets custom GSI name via index object', () => {
    @DynamoTable('gsi-name')
    class GsiNameTable {
      @StringAttribute({hashKey: true}) id!: string;
      @StringAttribute({index: {name: 'myCustomIndex'}}) tenantId!: string;
    }
    const schema = resolveTableSchema(GsiNameTable);
    const field = schema.definition['tenantId'] as {index: {name: string}};
    expect(field.index).toEqual({name: 'myCustomIndex'});
  });

  it('resolves rangeKey from TypeScript property name to DynamoDB attribute name', () => {
    @DynamoTable('gsi-rangekey')
    class GsiRangeKeyTable {
      @StringAttribute({hashKey: true}) id!: string;
      @StringAttribute({index: {name: 'byTenantAndDate', rangeKey: 'createdAt'}}) tenantId!: string;
      @CreateDateAttribute('created_at') createdAt!: Date;
    }
    const schema = resolveTableSchema(GsiRangeKeyTable);
    const field = schema.definition['tenantId'] as {index: {name: string; rangeKey: string}};
    expect(field.index).toEqual({name: 'byTenantAndDate', rangeKey: 'created_at'});
  });

  it('falls back to property name when rangeKey has no alias', () => {
    @DynamoTable('gsi-rangekey-noalias')
    class GsiRangeKeyNoAliasTable {
      @StringAttribute({hashKey: true}) id!: string;
      @StringAttribute({index: {rangeKey: 'status'}}) tenantId!: string;
      @StringAttribute() status!: string;
    }
    const schema = resolveTableSchema(GsiRangeKeyNoAliasTable);
    const field = schema.definition['tenantId'] as {index: {rangeKey: string}};
    expect(field.index).toEqual({rangeKey: 'status'});
  });

  it('sets project: false (KEYS_ONLY)', () => {
    @DynamoTable('gsi-project-false')
    class GsiProjectFalseTable {
      @StringAttribute({hashKey: true}) id!: string;
      @StringAttribute({index: {project: false}}) tenantId!: string;
    }
    const schema = resolveTableSchema(GsiProjectFalseTable);
    const field = schema.definition['tenantId'] as {index: {project: boolean}};
    expect(field.index).toEqual({project: false});
  });

  it('sets project as string array (INCLUDE)', () => {
    @DynamoTable('gsi-project-array')
    class GsiProjectArrayTable {
      @StringAttribute({hashKey: true}) id!: string;
      @StringAttribute({index: {project: ['id', 'name']}}) tenantId!: string;
    }
    const schema = resolveTableSchema(GsiProjectArrayTable);
    const field = schema.definition['tenantId'] as {index: {project: string[]}};
    expect(field.index).toEqual({project: ['id', 'name']});
  });

  it('sets all three fields together', () => {
    @DynamoTable('gsi-all-fields')
    class GsiAllFieldsTable {
      @StringAttribute({hashKey: true}) id!: string;
      @StringAttribute({index: {name: 'fullIndex', rangeKey: 'status', project: true}}) tenantId!: string;
      @StringAttribute() status!: string;
    }
    const schema = resolveTableSchema(GsiAllFieldsTable);
    const field = schema.definition['tenantId'] as {index: {name: string; rangeKey: string; project: boolean}};
    expect(field.index).toEqual({name: 'fullIndex', rangeKey: 'status', project: true});
  });

  it('falls back to rangeKey string when property not in aliasMap at all', () => {
    @DynamoTable('gsi-rangekey-ghost')
    class GsiRangeKeyGhostTable {
      @StringAttribute({hashKey: true}) id!: string;
      @StringAttribute({index: {rangeKey: 'ghostProp'}}) tenantId!: string;
    }
    const schema = resolveTableSchema(GsiRangeKeyGhostTable);
    const field = schema.definition['tenantId'] as {index: {rangeKey: string}};
    expect(field.index).toEqual({rangeKey: 'ghostProp'});
  });
});
