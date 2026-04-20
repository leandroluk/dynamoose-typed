import {DateAttribute, DynamoTable, NumberAttribute, SetAttribute, StringAttribute} from '#/index';
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
      expect(serializeDate(now, String)).toBe(now.toISOString());
    });

    it('serializes to timestamp number', () => {
      const now = new Date();
      expect(serializeDate(now, Number)).toBe(now.getTime());
    });

    it('returns Date object as is', () => {
      const now = new Date();
      expect(serializeDate(now, Date)).toBe(now);
    });
  });

  describe('date attribute defaults', () => {
    it('applies default serialization for CreateDateAttribute', () => {
      @DynamoTable('date-defaults')
      class DateDefaultsTable {
        @StringAttribute({hashKey: true}) id!: string;
        @DateAttribute({type: Number}) date!: Date;
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
