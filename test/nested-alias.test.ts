import {ArrayAttribute, DynamoDocument, DynamoTable, NestedAttribute, NumberAttribute, StringAttribute} from '#';
import {InternalModel} from '#/model/internal-model';
import {resolveTableSchema} from '#/schema';
import type * as dynamoose from 'dynamoose';
import {describe, expect, it, vi} from 'vitest';

// ── Fixtures: nested + deeply-nested + array of docs, all with aliases ────────

@DynamoDocument()
class GeoDoc {
  @NumberAttribute('lat')
  latitude!: number;

  @NumberAttribute('lng')
  longitude!: number;
}

@DynamoDocument()
class AddressDoc {
  @StringAttribute('street_name')
  street!: string;

  @StringAttribute() // no alias: attributeName === propertyKey
  country!: string;

  @NestedAttribute(() => GeoDoc, {alias: 'geo'})
  coordinates!: GeoDoc;
}

@DynamoDocument()
class TagDoc {
  @StringAttribute('tag_label')
  label!: string;
}

@DynamoTable('profiles')
class ProfileTable {
  @StringAttribute({hashKey: true})
  id!: string;

  @NestedAttribute(() => AddressDoc, {alias: 'addr'})
  address!: AddressDoc;

  @ArrayAttribute(() => TagDoc, {alias: 'tag_list'})
  tags!: TagDoc[];

  @ArrayAttribute(() => String, {alias: 'nick_list'})
  nicknames!: string[];
}

function makeStubModel() {
  return {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    query: vi.fn(),
    scan: vi.fn(),
    batchPut: vi.fn(),
    batchDelete: vi.fn(),
    batchGet: vi.fn(),
  } as unknown as ReturnType<typeof dynamoose.model>;
}

function makeModel() {
  const schema = resolveTableSchema(ProfileTable);
  return new InternalModel(ProfileTable, schema, makeStubModel());
}

// ── toAttributeKey: property name → DynamoDB attribute name (write path) ──────

describe('toAttributeKey — nested aliases', () => {
  it('renames a nested document and its aliased fields', () => {
    const model = makeModel();
    const out = model.toAttributeKey({
      id: '1',
      address: {street: 'Main', coordinates: {latitude: 1, longitude: 2}},
    } as unknown as Partial<ProfileTable>);

    expect(out['addr']).toEqual({street_name: 'Main', geo: {lat: 1, lng: 2}});
    expect('address' in out).toBe(false);
  });

  it('renames every element of an array of documents', () => {
    const model = makeModel();
    const out = model.toAttributeKey({
      id: '1',
      tags: [{label: 'a'}, {label: 'b'}],
    } as unknown as Partial<ProfileTable>);

    expect(out['tag_list']).toEqual([{tag_label: 'a'}, {tag_label: 'b'}]);
    expect('tags' in out).toBe(false);
  });

  it('renames the array attribute key but leaves primitive elements untouched', () => {
    const model = makeModel();
    const out = model.toAttributeKey({
      id: '1',
      nicknames: ['x', 'y'],
    } as unknown as Partial<ProfileTable>);

    expect(out['nick_list']).toEqual(['x', 'y']);
    expect('nicknames' in out).toBe(false);
  });

  it('passes through null/undefined nested values', () => {
    const model = makeModel();
    const out = model.toAttributeKey({
      id: '1',
      address: null,
      tags: undefined,
    } as unknown as Partial<ProfileTable>);

    expect(out['addr']).toBeNull();
    expect(out['tag_list']).toBeUndefined();
  });

  it('renames present fields, keeps un-aliased fields, and skips omitted ones', () => {
    const model = makeModel();
    const out = model.toAttributeKey({
      id: '1',
      address: {street: 'Main', country: 'BR'}, // `coordinates` omitted
    } as unknown as Partial<ProfileTable>);

    // street → street_name (aliased), country stays (no alias), coordinates absent
    expect(out['addr']).toEqual({street_name: 'Main', country: 'BR'});
    expect('coordinates' in (out['addr'] as Record<string, unknown>)).toBe(false);
    expect('geo' in (out['addr'] as Record<string, unknown>)).toBe(false);
  });

  it('passes through null elements inside an array of documents', () => {
    const model = makeModel();
    const out = model.toAttributeKey({
      id: '1',
      tags: [{label: 'a'}, null],
    } as unknown as Partial<ProfileTable>);

    expect(out['tag_list']).toEqual([{tag_label: 'a'}, null]);
  });

  it('passes through a non-array value on an array-of-documents attribute', () => {
    const model = makeModel();
    const out = model.toAttributeKey({
      id: '1',
      tags: {} as unknown,
    } as unknown as Partial<ProfileTable>);

    expect(out['tag_list']).toEqual({});
  });
});

// ── toPropertyObject: DynamoDB attribute name → property name (read path) ─────

describe('toPropertyObject — nested aliases', () => {
  it('restores a nested document and its aliased fields', () => {
    const model = makeModel();
    const out = model.toPropertyObject({
      id: '1',
      addr: {street_name: 'Main', geo: {lat: 1, lng: 2}},
    }) as unknown as Record<string, unknown>;

    expect(out['address']).toEqual({street: 'Main', coordinates: {latitude: 1, longitude: 2}});
    expect('addr' in out).toBe(false);
  });

  it('restores every element of an array of documents', () => {
    const model = makeModel();
    const out = model.toPropertyObject({
      id: '1',
      tag_list: [{tag_label: 'a'}, {tag_label: 'b'}],
    }) as unknown as Record<string, unknown>;

    expect(out['tags']).toEqual([{label: 'a'}, {label: 'b'}]);
    expect('tag_list' in out).toBe(false);
  });

  it('keeps unknown fields not present in the schema', () => {
    const model = makeModel();
    const out = model.toPropertyObject({id: '1', _extra: 'ghost'}) as unknown as Record<string, unknown>;
    expect(out['_extra']).toBe('ghost');
  });
});

// ── normalize: full round-trip via the read path ──────────────────────────────

describe('normalize — nested aliases', () => {
  it('produces a class instance with remapped nested keys', () => {
    const model = makeModel();
    const result = model.normalize({
      id: '1',
      addr: {street_name: 'Main', geo: {lat: 3, lng: 4}},
      tag_list: [{tag_label: 'a'}],
    }) as unknown as Record<string, unknown>;

    expect(result).toBeInstanceOf(ProfileTable);
    expect(result['address']).toEqual({street: 'Main', coordinates: {latitude: 3, longitude: 4}});
    expect(result['tags']).toEqual([{label: 'a'}]);
  });
});
