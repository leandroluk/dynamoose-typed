import {
  Attribute,
  DynamoTable,
  getDocumentMeta,
  getTableMeta,
  NumberAttribute,
  SetAttribute,
  StringAttribute,
} from '#/index';
import {describe, expect, it} from 'vitest';
import {AddressDoc, OrderTable, UserTable} from './fixtures';

@DynamoTable('extra_decorators_table')
class ExtraDecoratorsTable {
  @StringAttribute({hashKey: true})
  id!: string;

  @NumberAttribute({rangeKey: true})
  sort!: number;

  @SetAttribute(() => String)
  tags!: Set<string>;

  @Attribute({alias: 'old_field'})
  oldField!: string;
}

describe('decorator metadata', () => {
  describe('@DynamoDocument', () => {
    it('registers document metadata', () => {
      const meta = getDocumentMeta(AddressDoc);
      expect(meta).toBeDefined();
    });

    it('collects document attributes', () => {
      const meta = getDocumentMeta(AddressDoc)!;
      const keys = meta.attributes.map(a => a.propertyKey);
      expect(keys).toContain('street');
      expect(keys).toContain('city');
    });
  });

  describe('@DynamoTable', () => {
    it('registers table metadata', () => {
      const meta = getTableMeta(UserTable);
      expect(meta).toBeDefined();
      expect(meta?.tableName).toBe('users');
    });

    it('resolves hashKey from @StringAttribute({ hashKey: true })', () => {
      const meta = getTableMeta(UserTable)!;
      expect(meta.hashKey).toBe('id');
    });

    it('resolves rangeKey from @StringAttribute({ rangeKey: true })', () => {
      const meta = getTableMeta(OrderTable)!;
      expect(meta.rangeKey).toBe('orderId');
    });

    it('resolves deleteDateKey from @DeleteDateAttribute', () => {
      const meta = getTableMeta(UserTable)!;
      expect(meta.deleteDateKey).toBe('deletedAt');
    });

    it('collects all attributes', () => {
      const meta = getTableMeta(UserTable)!;
      const keys = meta.attributes.map(a => a.propertyKey);
      expect(keys).toEqual(
        expect.arrayContaining([
          'id',
          'name',
          'age',
          'isActive',
          'address',
          'hobbies',
          'createdAt',
          'updatedAt',
          'deletedAt',
        ])
      );
    });

    it('applies alias to attribute name', () => {
      const meta = getTableMeta(UserTable)!;
      const isActive = meta.attributes.find(a => a.propertyKey === 'isActive')!;
      expect(isActive.attributeName).toBe('is_active');
    });

    it('marks createDate / updateDate / deleteDate kinds correctly', () => {
      const meta = getTableMeta(UserTable)!;
      const kinds = Object.fromEntries(meta.attributes.map(a => [a.propertyKey, a.kind]));
      expect(kinds['createdAt']).toBe('createDate');
      expect(kinds['updatedAt']).toBe('updateDate');
      expect(kinds['deletedAt']).toBe('deleteDate');
    });

    it('supports hashKey and rangeKey passed via options', () => {
      const meta = getTableMeta(ExtraDecoratorsTable)!;
      expect(meta.hashKey).toBe('id');
      expect(meta.rangeKey).toBe('sort');
    });

    it('supports @SetAttribute', () => {
      const meta = getTableMeta(ExtraDecoratorsTable)!;
      const tags = meta.attributes.find(a => a.propertyKey === 'tags')!;
      expect(tags.kind).toBe('set');
      expect(tags.typeRef).toBeDefined();
    });

    it('supports generic @Attribute with alias', () => {
      const meta = getTableMeta(ExtraDecoratorsTable)!;
      const oldField = meta.attributes.find(a => a.propertyKey === 'oldField')!;
      expect(oldField.attributeName).toBe('old_field');
    });

    it('supports StringAttribute with alias string as first argument', () => {
      @DynamoTable('alias_table')
      class AliasTable {
        @StringAttribute('id_alias', {hashKey: true})
        id!: string;
      }
      const meta = getTableMeta(AliasTable)!;
      const id = meta.attributes.find(a => a.propertyKey === 'id')!;
      expect(id.attributeName).toBe('id_alias');
      expect(id.isHashKey).toBe(true);
    });

    it('supports StringAttribute with sortKey option', () => {
      @DynamoTable('sort_key_table')
      class SortKeyTable {
        @StringAttribute({hashKey: true})
        id!: string;
        @StringAttribute({sortKey: true})
        sk!: string;
      }
      const meta = getTableMeta(SortKeyTable)!;
      expect(meta.rangeKey).toBe('sk');
    });
  });
});
