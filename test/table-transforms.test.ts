import {
  ArrayAttribute,
  BooleanAttribute,
  CreateDateAttribute,
  DateAttribute,
  DeleteDateAttribute,
  DynamoDocument,
  DynamoTable,
  NestedAttribute,
  NumberAttribute,
  StringAttribute,
  UpdateDateAttribute,
  VersionAttribute,
} from '#';
import {parseDynamoTableItem, serializeDynamoTableItem} from '#/utils/table-transforms';
import {describe, expect, it} from 'vitest';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

// No @DynamoDocument — used to test the "no meta" fallback branch
class RawNested {
  x!: string;
}

@DynamoTable('raw-nested-table')
class RawNestedTable {
  @StringAttribute({hashKey: true})
  id!: string;

  @NestedAttribute(() => RawNested)
  raw!: RawNested | null;
}

@DynamoDocument()
class AddrDoc {
  @StringAttribute('city_name')
  city!: string;

  @CreateDateAttribute('created_at')
  createdAt!: Date;
}

@DynamoDocument()
class PlainDoc {
  @StringAttribute()
  label!: string;
}

class NotATable {
  id!: string;
}

@DynamoTable('items')
class ItemTable {
  @StringAttribute({hashKey: true})
  id!: string;

  @StringAttribute('full_name')
  name!: string;

  @NumberAttribute()
  count!: number;

  @BooleanAttribute()
  active!: boolean;

  @DateAttribute({format: 'epoch'})
  epochDate!: Date;

  @DateAttribute('iso_date', {format: 'iso'})
  isoDate!: Date;

  @DateAttribute('ttl_date', {ttl: true})
  ttlDate!: Date;

  @CreateDateAttribute('created_at')
  createdAt!: Date;

  @UpdateDateAttribute('updated_at')
  updatedAt!: Date;

  @DeleteDateAttribute('deleted_at')
  deletedAt!: Date | null;

  @NestedAttribute(() => AddrDoc)
  address?: AddrDoc | null;

  @NestedAttribute(() => PlainDoc)
  plain?: PlainDoc | null;

  @ArrayAttribute(() => AddrDoc)
  addrs!: AddrDoc[];

  @ArrayAttribute(() => String)
  tags!: string[];

  @VersionAttribute()
  version!: number;
}

// ─── serializeDynamoTableItem ─────────────────────────────────────────────────

describe('serializeDynamoTableItem', () => {
  it('renames aliased property to DynamoDB attribute name', () => {
    const item = Object.assign(new ItemTable(), {id: '1', name: 'Alice'});
    const out = serializeDynamoTableItem(item);
    expect(out['full_name']).toBe('Alice');
    expect('name' in out).toBe(false);
  });

  it('keeps property name when no alias defined', () => {
    const item = Object.assign(new ItemTable(), {id: '1', count: 5});
    const out = serializeDynamoTableItem(item);
    expect(out['count']).toBe(5);
  });

  it('serializes Date to epoch milliseconds for epoch format', () => {
    const d = new Date('2024-01-01T00:00:00.000Z');
    const item = Object.assign(new ItemTable(), {id: '1', epochDate: d});
    const out = serializeDynamoTableItem(item);
    expect(out['epochDate']).toBe(d.getTime());
  });

  it('serializes Date to ISO string for iso format', () => {
    const d = new Date('2024-06-01T12:00:00.000Z');
    const item = Object.assign(new ItemTable(), {id: '1', isoDate: d});
    const out = serializeDynamoTableItem(item);
    expect(out['iso_date']).toBe(d.toISOString());
  });

  it('serializes Date to epoch seconds for ttl format', () => {
    const d = new Date('2025-01-01T00:00:00.000Z');
    const item = Object.assign(new ItemTable(), {id: '1', ttlDate: d});
    const out = serializeDynamoTableItem(item);
    expect(out['ttl_date']).toBe(Math.floor(d.getTime() / 1000));
  });

  it('passes through non-Date value on a date-kind attribute', () => {
    const item = Object.assign(new ItemTable(), {id: '1', epochDate: 1234567890});
    const out = serializeDynamoTableItem(item);
    expect(out['epochDate']).toBe(1234567890);
  });

  it('serializes nested @DynamoDocument recursively', () => {
    const addr = Object.assign(new AddrDoc(), {city: 'NYC', createdAt: new Date('2024-01-01T00:00:00.000Z')});
    const item = Object.assign(new ItemTable(), {id: '1', address: addr});
    const out = serializeDynamoTableItem(item);
    expect((out['address'] as Record<string, unknown>)['city_name']).toBe('NYC');
    expect(typeof (out['address'] as Record<string, unknown>)['created_at']).toBe('number');
  });

  it('passes through null nested value', () => {
    const item = Object.assign(new ItemTable(), {id: '1', address: null});
    const out = serializeDynamoTableItem(item);
    expect(out['address']).toBeNull();
  });

  it('serializes array of @DynamoDocument elements', () => {
    const a1 = Object.assign(new AddrDoc(), {city: 'LA', createdAt: new Date('2024-01-01T00:00:00.000Z')});
    const a2 = Object.assign(new AddrDoc(), {city: 'SF', createdAt: new Date('2024-06-01T00:00:00.000Z')});
    const item = Object.assign(new ItemTable(), {id: '1', addrs: [a1, a2]});
    const out = serializeDynamoTableItem(item);
    const arr = out['addrs'] as Record<string, unknown>[];
    expect((arr[0] as Record<string, unknown>)['city_name']).toBe('LA');
    expect((arr[1] as Record<string, unknown>)['city_name']).toBe('SF');
  });

  it('passes through null element inside array of @DynamoDocument', () => {
    const a1 = Object.assign(new AddrDoc(), {city: 'LA', createdAt: new Date()});
    const item = Object.assign(new ItemTable(), {id: '1', addrs: [a1, null]});
    const out = serializeDynamoTableItem(item);
    const arr = out['addrs'] as unknown[];
    expect(arr[1]).toBeNull();
  });

  it('passes through array of non-document elements as-is', () => {
    const item = Object.assign(new ItemTable(), {id: '1', tags: ['a', 'b']});
    const out = serializeDynamoTableItem(item);
    expect(out['tags']).toEqual(['a', 'b']);
  });

  it('passes through unknown fields not in schema', () => {
    const item = Object.assign(new ItemTable(), {id: '1'});
    (item as unknown as Record<string, unknown>)['_extra'] = 'ghost';
    const out = serializeDynamoTableItem(item);
    expect(out['_extra']).toBe('ghost');
  });

  it('passes through null value on non-date attribute', () => {
    const item = Object.assign(new ItemTable(), {id: '1', plain: null});
    const out = serializeDynamoTableItem(item);
    expect(out['plain']).toBeNull();
  });

  it('passes through undefined value', () => {
    const item = Object.assign(new ItemTable(), {id: '1', address: undefined});
    const out = serializeDynamoTableItem(item);
    expect(out['address']).toBeUndefined();
  });

  it('handles version attribute (non-date, non-nested, non-array)', () => {
    const item = Object.assign(new ItemTable(), {id: '1', version: 3});
    const out = serializeDynamoTableItem(item);
    expect(out['version']).toBe(3);
  });

  it('passes through nested value when nested class has no @DynamoDocument (no meta fallback)', () => {
    const item = Object.assign(new RawNestedTable(), {id: '1', raw: {x: 'hello'}});
    const out = serializeDynamoTableItem(item);
    expect(out['raw']).toEqual({x: 'hello'});
  });

  it('passes through non-array value on an array-kind attribute', () => {
    const item = Object.assign(new ItemTable(), {id: '1', addrs: null});
    const out = serializeDynamoTableItem(item);
    expect(out['addrs']).toBeNull();
  });

  it('throws when class is missing @DynamoTable', () => {
    const item = new NotATable();
    expect(() => serializeDynamoTableItem(item)).toThrow('@DynamoTable');
  });
});

// ─── parseDynamoTableItem ─────────────────────────────────────────────────────

describe('parseDynamoTableItem', () => {
  it('renames DynamoDB attribute name to TypeScript property key', () => {
    const result = parseDynamoTableItem(ItemTable, {id: '1', full_name: 'Alice'});
    expect(result.name).toBe('Alice');
    expect('full_name' in result).toBe(false);
  });

  it('keeps key when no alias (attributeName === propertyKey)', () => {
    const result = parseDynamoTableItem(ItemTable, {id: '1', count: 5});
    expect(result.count).toBe(5);
  });

  it('parses epoch milliseconds number to Date', () => {
    const ms = new Date('2024-01-01T00:00:00.000Z').getTime();
    const result = parseDynamoTableItem(ItemTable, {id: '1', epochDate: ms});
    expect(result.epochDate).toBeInstanceOf(Date);
    expect(result.epochDate.getTime()).toBe(ms);
  });

  it('parses ISO string to Date', () => {
    const iso = '2024-06-01T12:00:00.000Z';
    const result = parseDynamoTableItem(ItemTable, {id: '1', iso_date: iso});
    expect(result.isoDate).toBeInstanceOf(Date);
    expect(result.isoDate.toISOString()).toBe(iso);
  });

  it('parses TTL seconds number to Date', () => {
    const sec = Math.floor(new Date('2025-01-01T00:00:00.000Z').getTime() / 1000);
    const result = parseDynamoTableItem(ItemTable, {id: '1', ttl_date: sec});
    expect(result.ttlDate).toBeInstanceOf(Date);
    expect(result.ttlDate.getTime()).toBe(sec * 1000);
  });

  it('passes through null on a date-kind attribute (does not convert to Date)', () => {
    const result = parseDynamoTableItem(ItemTable, {id: '1', deleted_at: null});
    expect(result.deletedAt).toBeNull();
  });

  it('parses nested @DynamoDocument recursively', () => {
    const raw = {id: '1', address: {city_name: 'NYC', created_at: 1704067200000}};
    const result = parseDynamoTableItem(ItemTable, raw);
    expect((result.address as unknown as Record<string, unknown>)['city']).toBe('NYC');
    expect((result.address as unknown as Record<string, unknown>)['createdAt']).toBeInstanceOf(Date);
  });

  it('passes through null nested value without conversion', () => {
    const result = parseDynamoTableItem(ItemTable, {id: '1', address: null});
    expect(result.address).toBeNull();
  });

  it('parses array of @DynamoDocument elements', () => {
    const raw = {
      id: '1',
      addrs: [
        {city_name: 'LA', created_at: 1704067200000},
        {city_name: 'SF', created_at: 1717200000000},
      ],
    };
    const result = parseDynamoTableItem(ItemTable, raw);
    const arr = result.addrs as unknown as Record<string, unknown>[];
    expect((arr[0] as Record<string, unknown>)['city']).toBe('LA');
    expect((arr[0] as Record<string, unknown>)['createdAt']).toBeInstanceOf(Date);
  });

  it('passes through null element inside array of @DynamoDocument', () => {
    const raw = {id: '1', addrs: [{city_name: 'LA', created_at: 1704067200000}, null]};
    const result = parseDynamoTableItem(ItemTable, raw);
    const arr = result.addrs as unknown as unknown[];
    expect(arr[1]).toBeNull();
  });

  it('passes through array of non-document elements', () => {
    const result = parseDynamoTableItem(ItemTable, {id: '1', tags: ['x', 'y']});
    expect(result.tags).toEqual(['x', 'y']);
  });

  it('passes through unknown fields not in schema', () => {
    const result = parseDynamoTableItem(ItemTable, {id: '1', _extra: 'ghost'});
    expect((result as unknown as Record<string, unknown>)['_extra']).toBe('ghost');
  });

  it('returns a proper class instance', () => {
    const result = parseDynamoTableItem(ItemTable, {id: '1'});
    expect(result).toBeInstanceOf(ItemTable);
  });

  it('passes through nested value when nested class has no @DynamoDocument (no meta fallback)', () => {
    const result = parseDynamoTableItem(RawNestedTable, {id: '1', raw: {x: 'hello'}});
    expect((result as unknown as Record<string, unknown>)['raw']).toEqual({x: 'hello'});
  });

  it('passes through non-array value on an array-kind attribute', () => {
    const result = parseDynamoTableItem(ItemTable, {id: '1', addrs: null});
    expect(result.addrs).toBeNull();
  });

  it('throws when class is missing @DynamoTable', () => {
    expect(() => parseDynamoTableItem(NotATable, {id: '1'})).toThrow('@DynamoTable');
  });
});

// ─── alias-in-options regression (bug fix) ───────────────────────────────────

@DynamoDocument()
class ContactDoc {
  @StringAttribute('street')
  streetName!: string;
}

@DynamoTable('contacts')
class ContactTable {
  @StringAttribute({hashKey: true})
  id!: string;

  @ArrayAttribute(() => String, {alias: 'phones'})
  phoneNumberList!: string[];

  @NestedAttribute(() => ContactDoc, {alias: 'addr'})
  address?: ContactDoc;
}

describe('alias in options (bug fix)', () => {
  it('serializeDynamoTableItem renames ArrayAttribute with alias in options', () => {
    const item = Object.assign(new ContactTable(), {id: '1', phoneNumberList: ['+5511999']});
    const out = serializeDynamoTableItem(item);
    expect(out['phones']).toEqual(['+5511999']);
    expect('phoneNumberList' in out).toBe(false);
  });

  it('serializeDynamoTableItem renames NestedAttribute with alias in options', () => {
    const doc = Object.assign(new ContactDoc(), {streetName: 'Main St'});
    const item = Object.assign(new ContactTable(), {id: '1', address: doc});
    const out = serializeDynamoTableItem(item);
    expect((out['addr'] as Record<string, unknown>)['street']).toBe('Main St');
    expect('address' in out).toBe(false);
  });

  it('parseDynamoTableItem restores ArrayAttribute with alias in options', () => {
    const result = parseDynamoTableItem(ContactTable, {id: '1', phones: ['+5511999']});
    expect(result.phoneNumberList).toEqual(['+5511999']);
    expect('phones' in result).toBe(false);
  });

  it('parseDynamoTableItem restores NestedAttribute with alias in options', () => {
    const result = parseDynamoTableItem(ContactTable, {id: '1', addr: {street: 'Main St'}});
    expect((result.address as unknown as Record<string, unknown>)['streetName']).toBe('Main St');
    expect('addr' in result).toBe(false);
  });
});
