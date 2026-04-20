/**
 * Final coverage pass — closes every remaining gap:
 *
 * entity-manager.ts:24,34-110   all delegating methods
 * data-source.ts:164            #register early-return branch
 * repository.ts:84,95,123,173-178  findOneByOrFail return, find+scan limit, delete soft path
 * schema-builder.ts:126,237     nestedMeta?? fallback, _hooks destructure
 * internal-model.ts:44,56-113   nested/array without DynamoDocument meta (no-op branches)
 * attribute.decorators.ts       uncovered option branches
 */

import {DataSource} from '#/data-source/data-source';
import {Attribute} from '#/decorators/attribute.decorators';
import {DynamoDocument, DynamoTable, DynamoTable as DynamoTableClass} from '#/decorators/class.decorators';
import {getTableMeta} from '#/decorators/metadata.registry';
import {
  ArrayAttribute,
  BooleanAttribute,
  CreateDateAttribute,
  DateAttribute,
  DeleteDateAttribute,
  NestedAttribute,
  NumberAttribute,
  SetAttribute,
  StringAttribute,
  UpdateDateAttribute,
} from '#/index';
import {InternalModel} from '#/model/internal-model';
import {resolveTableSchema} from '#/schema';
import type {AnyRecord} from '#/types';
import dynamoose from 'dynamoose';
import {type Mock, beforeEach, describe, expect, it, vi} from 'vitest';
import {AuditedOrderTable, OrderTable, UserTable} from './fixtures';

// ── Mock model interface + factory ───────────────────────────────────────────

interface MockDynamooseModel {
  get: Mock;
  create: Mock;
  update: Mock;
  delete: Mock;
  batchGet: Mock;
  batchPut: Mock;
  batchDelete: Mock;
  transaction: {
    create: Mock;
    update: Mock;
    delete: Mock;
  };
  query: Mock;
  scan: Mock;
}

const makeMockDynamooseModel = (): MockDynamooseModel => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  batchGet: vi.fn(),
  batchPut: vi.fn(),
  batchDelete: vi.fn(),
  transaction: {
    create: vi.fn().mockReturnValue({type: 'create'}),
    update: vi.fn().mockReturnValue({type: 'update'}),
    delete: vi.fn().mockReturnValue({type: 'delete'}),
  },
  query: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    consistent: vi.fn().mockReturnThis(),
    startAt: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
  }),
  scan: vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnThis(),
    startAt: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
  }),
});

const makeItem = (data: Record<string, unknown>): Record<string, unknown> => ({
  ...data,
  toJSON: (): Record<string, unknown> => data,
});

// ── Shared dynamoose mock ─────────────────────────────────────────────────────

vi.mock('dynamoose', async importOriginal => {
  const actual = await importOriginal();

  class MockInstance {
    aws = {ddb: {set: vi.fn(), local: vi.fn()}};
    Table = vi.fn();
  }

  const inlineBaselineMock = {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchGet: vi.fn(),
    batchPut: vi.fn(),
    batchDelete: vi.fn(),
    transaction: {
      create: vi.fn().mockReturnValue({type: 'create'}),
      update: vi.fn().mockReturnValue({type: 'update'}),
      delete: vi.fn().mockReturnValue({type: 'delete'}),
    },
    query: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
    }),
    scan: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
    }),
  };

  return {
    ...(actual as Record<string, unknown>),
    model: vi.fn().mockReturnValue(inlineBaselineMock),
    Schema: vi.fn().mockImplementation((definition: unknown) => ({definition})),
    transaction: vi.fn().mockResolvedValue(undefined),
    Instance: MockInstance,
    default: {
      model: vi.fn().mockReturnValue(inlineBaselineMock),
      Schema: vi.fn(),
      transaction: vi.fn().mockResolvedValue(undefined),
      Instance: MockInstance,
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. EntityManager full surface
// ─────────────────────────────────────────────────────────────────────────────

describe('EntityManager full surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create() delegates to repository', async () => {
    vi.spyOn(dynamoose, 'model').mockReturnValue(makeMockDynamooseModel() as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const createdUser = entityManager.create(UserTable, {id: '1', name: 'Alice'});
    expect(createdUser.id).toBe('1');
    expect(createdUser.name).toBe('Alice');
  });

  it('save() with explicit EntityClass', async () => {
    const createMock = vi.fn().mockResolvedValue(makeItem({id: '1', name: 'Alice'}));
    vi.spyOn(dynamoose, 'model').mockReturnValue({create: createMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const userInstance = new UserTable();
    userInstance.id = '1';
    userInstance.name = 'Alice';
    const savedUser = await entityManager.save(userInstance);
    expect(savedUser).toBeDefined();
  });

  it('save() infers EntityClass from constructor', async () => {
    const createMock = vi.fn().mockResolvedValue(makeItem({id: '2', name: 'Bob'}));
    vi.spyOn(dynamoose, 'model').mockReturnValue({create: createMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const userInstance = new UserTable();
    userInstance.id = '2';
    userInstance.name = 'Bob';
    const savedUser = await entityManager.save(userInstance);
    expect(savedUser).toBeDefined();
  });

  it('update() delegates', async () => {
    const updateMock = vi.fn().mockResolvedValue(makeItem({id: '1', name: 'Updated'}));
    vi.spyOn(dynamoose, 'model').mockReturnValue({update: updateMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const updatedUser = await entityManager.update(UserTable, {id: '1'}, {name: 'Updated'});
    expect(updatedUser.name).toBe('Updated');
  });

  it('findOneBy() delegates', async () => {
    const getMock = vi.fn().mockResolvedValue(null);
    vi.spyOn(dynamoose, 'model').mockReturnValue({get: getMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const foundUser = await entityManager.findOneBy(UserTable, {id: 'x'});
    expect(foundUser).toBeUndefined();
  });

  it('findOneByOrFail() throws when not found', async () => {
    const getMock = vi.fn().mockResolvedValue(null);
    vi.spyOn(dynamoose, 'model').mockReturnValue({get: getMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    await expect(entityManager.findOneByOrFail(UserTable, {id: 'x'})).rejects.toThrow('not found');
  });

  it('find() delegates', async () => {
    const queryExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    const queryChainMock = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: queryExecMock,
    };
    vi.spyOn(dynamoose, 'model').mockReturnValue({query: vi.fn().mockReturnValue(queryChainMock)} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const findResult = await entityManager.find(UserTable, 'u1');
    expect(findResult.items).toEqual([]);
  });

  it('scan() delegates', async () => {
    const scanExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    const scanChainMock = {limit: vi.fn().mockReturnThis(), startAt: vi.fn().mockReturnThis(), exec: scanExecMock};
    vi.spyOn(dynamoose, 'model').mockReturnValue({scan: vi.fn().mockReturnValue(scanChainMock)} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const scanResult = await entityManager.scan(UserTable);
    expect(scanResult.items).toEqual([]);
  });

  it('count() delegates', async () => {
    const countExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    const countScanChainMock = {
      limit: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: countExecMock,
    };
    vi.spyOn(dynamoose, 'model').mockReturnValue({scan: vi.fn().mockReturnValue(countScanChainMock)} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const countResult = await entityManager.count(UserTable);
    expect(countResult).toBe(0);
  });

  it('delete() soft-deletes', async () => {
    const getMock = vi.fn().mockResolvedValue(makeItem({id: '1', name: 'Alice'}));
    const updateMock = vi.fn().mockResolvedValue(makeItem({id: '1', name: 'Alice', deleted_at: new Date()}));
    vi.spyOn(dynamoose, 'model').mockReturnValue({get: getMock, update: updateMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    await entityManager.delete(UserTable, {id: '1'});
    expect(updateMock).toHaveBeenCalled();
  });

  it('hardDelete() delegates', async () => {
    const getMock = vi.fn().mockResolvedValue(makeItem({id: '1'}));
    const deleteMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(dynamoose, 'model').mockReturnValue({get: getMock, delete: deleteMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    await entityManager.hardDelete(UserTable, {id: '1'});
    expect(deleteMock).toHaveBeenCalled();
  });

  it('restore() delegates', async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(dynamoose, 'model').mockReturnValue({update: updateMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    await entityManager.restore(UserTable, {id: '1'});
    expect(updateMock).toHaveBeenCalledWith({id: '1'}, {deleted_at: null});
  });

  it('batchSave() delegates', async () => {
    const batchPutMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(dynamoose, 'model').mockReturnValue({batchPut: batchPutMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const userInstance = new UserTable();
    userInstance.id = '1';
    await entityManager.batchSave(UserTable, [userInstance]);
    expect(batchPutMock).toHaveBeenCalled();
  });

  it('batchDelete() delegates', async () => {
    const batchDeleteMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(dynamoose, 'model').mockReturnValue({batchDelete: batchDeleteMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    await entityManager.batchDelete(UserTable, [{id: '1'}]);
    expect(batchDeleteMock).toHaveBeenCalled();
  });

  it('batchGet() delegates', async () => {
    const batchGetMock = vi.fn().mockResolvedValue([makeItem({id: '1', name: 'Alice'})]);
    vi.spyOn(dynamoose, 'model').mockReturnValue({batchGet: batchGetMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const batchResults = await entityManager.batchGet(UserTable, [{id: '1'}]);
    expect(batchResults[0]).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. data-source.ts:164 — #register early-return
// ─────────────────────────────────────────────────────────────────────────────

describe('DataSource #register early-return', () => {
  it('registering the same entity twice does not throw and skips re-registration', async () => {
    vi.clearAllMocks();
    const dynamooseModelSpy = vi.spyOn(dynamoose, 'model').mockReturnValue(makeMockDynamooseModel() as any);
    const dataSource = new DataSource({entities: [UserTable]});
    const firstRepository = dataSource.getRepository(UserTable);
    const secondRepository = dataSource.getRepository(UserTable);
    expect(firstRepository).toBeDefined();
    expect(secondRepository).toBeDefined();
    expect(dynamooseModelSpy.mock.calls).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. repository.ts — remaining uncovered lines
// ─────────────────────────────────────────────────────────────────────────────

describe('Repository remaining branches (mocked dynamoose)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findOneByOrFail returns item when found', async () => {
    const getMock = vi.fn().mockResolvedValue(makeItem({id: '1', name: 'Alice'}));
    vi.spyOn(dynamoose, 'model').mockReturnValue({get: getMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const userRepository = dataSource.getRepository(UserTable);
    const foundUser = await userRepository.findOneByOrFail({id: '1'});
    expect(foundUser.name).toBe('Alice');
  });

  it('find() with limit calls q.limit()', async () => {
    const limitMock = vi.fn().mockReturnThis();
    const queryExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    const queryChainMock = {
      eq: vi.fn().mockReturnThis(),
      limit: limitMock,
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: queryExecMock,
    };
    vi.spyOn(dynamoose, 'model').mockReturnValue({query: vi.fn().mockReturnValue(queryChainMock)} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const userRepository = dataSource.getRepository(UserTable);
    await userRepository.find('u1', {limit: 5});
    expect(limitMock).toHaveBeenCalledWith(5);
  });

  it('scan() with limit calls s.limit()', async () => {
    const limitMock = vi.fn().mockReturnThis();
    const scanExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    vi.spyOn(dynamoose, 'model').mockReturnValue({
      scan: vi.fn().mockReturnValue({limit: limitMock, startAt: vi.fn().mockReturnThis(), exec: scanExecMock}),
    } as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const userRepository = dataSource.getRepository(UserTable);
    await userRepository.scan({limit: 3});
    expect(limitMock).toHaveBeenCalledWith(3);
  });

  it('delete() soft path calls update with deleted_at timestamp', async () => {
    const getMock = vi.fn().mockResolvedValue(makeItem({id: '1', name: 'Alice'}));
    const updateMock = vi.fn().mockResolvedValue(makeItem({id: '1', name: 'Alice', deleted_at: new Date()}));
    vi.spyOn(dynamoose, 'model').mockReturnValue({get: getMock, update: updateMock} as any);
    const dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
    const userRepository = dataSource.getRepository(UserTable);
    await userRepository.delete({id: '1'});
    expect(updateMock).toHaveBeenCalled();
    const [, updateChanges] = updateMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect('deleted_at' in updateChanges).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. schema-builder.ts remaining branches
// ─────────────────────────────────────────────────────────────────────────────

describe('schema-builder remaining branches', () => {
  it('nested typeRef to plain class (no @DynamoDocument) uses empty attrs', () => {
    class PlainClass {
      value!: string;
    }

    @DynamoTable('nested-plain-table')
    class NestedPlainTable {
      @StringAttribute({hashKey: true})
      id!: string;

      @NestedAttribute(() => PlainClass)
      inner!: PlainClass;
    }

    const tableSchema = resolveTableSchema(NestedPlainTable);
    const innerField = tableSchema.definition['inner'] as {type: unknown; schema: Record<string, unknown>};
    expect(innerField.type).toBe(Object);
    expect(innerField.schema).toEqual({});
  });

  it('table with hooks: _hooks is stripped from tableOptions', () => {
    const beforeInsertHook = vi.fn();

    @DynamoTableClass('hooks-strip-table', {hooks: {beforeInsert: beforeInsertHook}})
    class HooksStripTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }

    const tableSchema = resolveTableSchema(HooksStripTable);
    expect(tableSchema.tableOptions).not.toHaveProperty('_hooks');
    expect(tableSchema.tableOptions).toHaveProperty('hooks');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. internal-model.ts edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('injectTimestampsDeep edge cases', () => {
  it('nested attr with non-document typeRef is a no-op', () => {
    class PlainNested {
      street!: string;
    }

    @DynamoTable('plain-nested-inject')
    class PlainNestedTable {
      @StringAttribute({hashKey: true})
      id!: string;

      @NestedAttribute(() => PlainNested)
      address?: PlainNested;
    }

    const tableSchema = resolveTableSchema(PlainNestedTable);
    const plainNestedMockModel = makeMockDynamooseModel();
    const internalModel = new InternalModel(
      PlainNestedTable,
      tableSchema,
      plainNestedMockModel as unknown as ReturnType<typeof dynamoose.model>
    );
    const entityRecord: AnyRecord = {id: '1', address: {street: 'Rua X'}};
    expect(() => internalModel.injectCreateTimestamps(entityRecord)).not.toThrow();
    expect((entityRecord['address'] as AnyRecord)['created_at']).toBeUndefined();
  });

  it('array attr with non-document element type is a no-op', () => {
    class PlainElem {
      name!: string;
    }

    @DynamoTable('plain-array-inject')
    class PlainArrayTable {
      @StringAttribute({hashKey: true})
      id!: string;

      @ArrayAttribute(() => PlainElem)
      items!: PlainElem[];
    }

    const tableSchema = resolveTableSchema(PlainArrayTable);
    const plainArrayMockModel = makeMockDynamooseModel();
    const internalModel = new InternalModel(
      PlainArrayTable,
      tableSchema,
      plainArrayMockModel as unknown as ReturnType<typeof dynamoose.model>
    );
    const arrayElement = {name: 'X'};
    const entityRecord: AnyRecord = {id: '1', items: [arrayElement]};
    expect(() => internalModel.injectCreateTimestamps(entityRecord)).not.toThrow();
    expect((arrayElement as AnyRecord)['created_at']).toBeUndefined();
  });

  it('toAttributeKey uses raw key when not in aliasMap', () => {
    const tableSchema = resolveTableSchema(UserTable);
    const userMockModel = makeMockDynamooseModel();
    const internalModel = new InternalModel(
      UserTable,
      tableSchema,
      userMockModel as unknown as ReturnType<typeof dynamoose.model>
    );
    const attributeKeyResult = internalModel.toAttributeKey({id: '1', unknownProp: 'x'} as Partial<UserTable> & {
      unknownProp: string;
    });
    expect(attributeKeyResult['id']).toBe('1');
    expect(attributeKeyResult['unknownProp']).toBe('x');
  });

  it('toPropertyObject uses raw key when not in reverseAliasMap', () => {
    const tableSchema = resolveTableSchema(UserTable);
    const userMockModel = makeMockDynamooseModel();
    const internalModel = new InternalModel(
      UserTable,
      tableSchema,
      userMockModel as unknown as ReturnType<typeof dynamoose.model>
    );
    const propertyObjectResult = internalModel.toPropertyObject({is_active: true, unknownAttr: 'x'}) as any;
    expect(propertyObjectResult.isActive).toBe(true);
    expect(propertyObjectResult.unknownAttr).toBe('x');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. attribute.decorators.ts — uncovered option branches
// ─────────────────────────────────────────────────────────────────────────────

describe('attribute decorator option branches', () => {
  it('attribute get/set options mapping for all types', () => {
    @DynamoDocument()
    class GetSetNested {
      @StringAttribute() s!: string;
    }

    @DynamoTable('get-set-all')
    class GetSetAll {
      @StringAttribute({hashKey: true, get: vi.fn(), set: vi.fn()})
      id!: string;
      @NumberAttribute({get: vi.fn(), set: vi.fn()})
      num!: number;
      @BooleanAttribute({get: vi.fn(), set: vi.fn()})
      bool!: boolean;
      @DateAttribute({get: vi.fn(), set: vi.fn()})
      dt!: Date;
      @NestedAttribute(() => GetSetNested, {get: vi.fn(), set: vi.fn()})
      nest!: GetSetNested;
      @ArrayAttribute(() => String as any, {get: vi.fn(), set: vi.fn()})
      arr!: string[];
      @SetAttribute(() => String as any, {get: vi.fn(), set: vi.fn()})
      aset!: Set<string>;
    }

    const tableSchema = resolveTableSchema(GetSetAll);
    const schemaDef = tableSchema.definition;
    expect((schemaDef['id'] as any).get).toBeDefined();
    expect((schemaDef['id'] as any).set).toBeDefined();
    expect((schemaDef['num'] as any).get).toBeDefined();
    expect((schemaDef['num'] as any).set).toBeDefined();
    expect((schemaDef['bool'] as any).get).toBeDefined();
    expect((schemaDef['bool'] as any).set).toBeDefined();
    expect((schemaDef['dt'] as any).get).toBeDefined();
    expect((schemaDef['dt'] as any).set).toBeDefined();
    expect((schemaDef['nest'] as any).get).toBeDefined();
    expect((schemaDef['nest'] as any).set).toBeDefined();
    expect((schemaDef['arr'] as any).get).toBeDefined();
    expect((schemaDef['arr'] as any).set).toBeDefined();
    expect((schemaDef['aset'] as any).get).toBeDefined();
    expect((schemaDef['aset'] as any).set).toBeDefined();
  });

  it('StringAttribute with alias string + hashKey + rangeKey', () => {
    @DynamoTable('str-full')
    class StrFull {
      @StringAttribute('pk', {hashKey: true})
      id!: string;

      @StringAttribute('sk', {rangeKey: true})
      sort!: string;
    }

    const tableMeta = getTableMeta(StrFull)!;
    expect(tableMeta.hashKey).toBe('pk');
    expect(tableMeta.rangeKey).toBe('sk');
  });

  it('NumberAttribute with alias string + hashKey + rangeKey', () => {
    @DynamoTable('num-full')
    class NumFull {
      @NumberAttribute('pk', {hashKey: true})
      id!: number;

      @NumberAttribute('sk', {rangeKey: true})
      sort!: number;
    }

    const tableMeta = getTableMeta(NumFull)!;
    expect(tableMeta.hashKey).toBe('pk');
    expect(tableMeta.rangeKey).toBe('sk');
  });

  it('StringAttribute validation options branch', () => {
    @DynamoTable('str-valid')
    class StrValid {
      @StringAttribute({hashKey: true}) id!: string;
      @StringAttribute({minLength: 2, maxLength: 5}) str!: string;
    }
    const tableSchema = resolveTableSchema(StrValid);
    const validateFn = (tableSchema.definition['str'] as any).validate;
    expect(validateFn('a')).toBe(false);
    expect(validateFn('abcdef')).toBe(false);
    expect(validateFn('abc')).toBe(true);
  });

  it('NumberAttribute validation options branch', () => {
    @DynamoTable('num-valid')
    class NumValid {
      @StringAttribute({hashKey: true}) id!: string;
      @NumberAttribute({min: 10, max: 20}) num!: number;
    }
    const tableSchema = resolveTableSchema(NumValid);
    const validateFn = (tableSchema.definition['num'] as any).validate;
    expect(validateFn(5)).toBe(false);
    expect(validateFn(25)).toBe(false);
    expect(validateFn(15)).toBe(true);
  });

  it('BooleanAttribute with alias string and options object', () => {
    @DynamoTable('bool-alias')
    class BoolAlias {
      @StringAttribute({hashKey: true}) id!: string;

      @BooleanAttribute('is_active', {default: false})
      isActive!: boolean;
    }

    const tableMeta = getTableMeta(BoolAlias)!;
    const isActiveAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'isActive')!;
    expect(isActiveAttr.attributeName).toBe('is_active');
    expect(isActiveAttr.kind).toBe('boolean');
  });

  it('BooleanAttribute with only options object (no alias)', () => {
    @DynamoTable('bool-opts')
    class BoolOpts {
      @StringAttribute({hashKey: true}) id!: string;

      @BooleanAttribute({default: true})
      flag!: boolean;
    }

    const tableMeta = getTableMeta(BoolOpts)!;
    const flagAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'flag')!;
    expect(flagAttr.attributeName).toBe('flag');
    expect(flagAttr.kind).toBe('boolean');
  });

  it('DateAttribute with alias string and type option', () => {
    @DynamoTable('date-alias')
    class DateAlias {
      @StringAttribute({hashKey: true}) id!: string;

      @DateAttribute('start_date', {type: String})
      startDate!: Date;
    }

    const tableMeta = getTableMeta(DateAlias)!;
    const startDateAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'startDate')!;
    expect(startDateAttr.attributeName).toBe('start_date');
    expect(startDateAttr.timestampType).toBe(String);
  });

  it('DateAttribute with only options object (no alias)', () => {
    @DynamoTable('date-opts-only')
    class DateOptsOnly {
      @StringAttribute({hashKey: true}) id!: string;

      @DateAttribute({type: Number})
      ts!: Date;
    }

    const tableMeta = getTableMeta(DateOptsOnly)!;
    const tsAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'ts')!;
    expect(tsAttr.timestampType).toBe(Number);
  });

  it('CreateDateAttribute with only options object (no alias)', () => {
    @DynamoTable('create-opts')
    class CreateOpts {
      @StringAttribute({hashKey: true}) id!: string;

      @CreateDateAttribute({type: Number})
      createdAt!: Date;
    }

    const tableMeta = getTableMeta(CreateOpts)!;
    const createdAtAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'createdAt')!;
    expect(createdAtAttr.kind).toBe('createDate');
    expect(createdAtAttr.timestampType).toBe(Number);
  });

  it('UpdateDateAttribute with alias string', () => {
    @DynamoTable('update-alias')
    class UpdateAlias {
      @StringAttribute({hashKey: true}) id!: string;

      @UpdateDateAttribute('updated_at', {type: String})
      updatedAt!: Date;
    }

    const tableMeta = getTableMeta(UpdateAlias)!;
    const updatedAtAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'updatedAt')!;
    expect(updatedAtAttr.attributeName).toBe('updated_at');
    expect(updatedAtAttr.kind).toBe('updateDate');
  });

  it('UpdateDateAttribute with only options object (no alias)', () => {
    @DynamoTable('update-opts')
    class UpdateOpts {
      @StringAttribute({hashKey: true}) id!: string;

      @UpdateDateAttribute({type: Date})
      updatedAt!: Date;
    }

    const tableMeta = getTableMeta(UpdateOpts)!;
    const updatedAtAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'updatedAt')!;
    expect(updatedAtAttr.kind).toBe('updateDate');
    expect(updatedAtAttr.timestampType).toBe(Date);
  });

  it('DeleteDateAttribute with alias string', () => {
    @DynamoTable('delete-alias')
    class DeleteAlias {
      @StringAttribute({hashKey: true}) id!: string;

      @DeleteDateAttribute('deleted_at', {type: Date})
      deletedAt!: Date | null;
    }

    const tableMeta = getTableMeta(DeleteAlias)!;
    const deletedAtAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'deletedAt')!;
    expect(deletedAtAttr.attributeName).toBe('deleted_at');
    expect(deletedAtAttr.kind).toBe('deleteDate');
  });

  it('DeleteDateAttribute with only options object (no alias)', () => {
    @DynamoTable('delete-opts')
    class DeleteOpts {
      @StringAttribute({hashKey: true}) id!: string;

      @DeleteDateAttribute({type: String})
      deletedAt!: Date | null;
    }

    const tableMeta = getTableMeta(DeleteOpts)!;
    const deletedAtAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'deletedAt')!;
    expect(deletedAtAttr.kind).toBe('deleteDate');
    expect(deletedAtAttr.timestampType).toBe(String);
  });

  it('NestedAttribute with opts', () => {
    @DynamoDocument()
    class AddrDoc {
      @StringAttribute() street!: string;
    }

    @DynamoTable('nested-opts')
    class NestedOpts {
      @StringAttribute({hashKey: true}) id!: string;

      @NestedAttribute(() => AddrDoc, {required: true})
      address!: AddrDoc;
    }

    const tableMeta = getTableMeta(NestedOpts)!;
    const addressAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'address')!;
    expect(addressAttr.kind).toBe('nested');
    expect(addressAttr.options['required']).toBe(true);
  });

  it('ArrayAttribute with opts', () => {
    @DynamoTable('array-opts')
    class ArrayOpts {
      @StringAttribute({hashKey: true}) id!: string;

      @ArrayAttribute(() => String as unknown as new () => unknown, {default: () => []})
      tags!: string[];
    }

    const tableMeta = getTableMeta(ArrayOpts)!;
    const tagsAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'tags')!;
    expect(tagsAttr.kind).toBe('array');
  });

  it('SetAttribute with opts', () => {
    @DynamoTable('set-opts')
    class SetOpts {
      @StringAttribute({hashKey: true}) id!: string;

      @SetAttribute(() => String as unknown as new () => unknown, {default: () => new Set()})
      roles!: Set<string>;
    }

    const tableMeta = getTableMeta(SetOpts)!;
    const rolesAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'roles')!;
    expect(rolesAttr.kind).toBe('set');
  });

  it('StringAttribute with no args (bare decorator)', () => {
    @DynamoTable('bare-string')
    class BareString {
      @StringAttribute({hashKey: true}) id!: string;

      @StringAttribute()
      name!: string;
    }

    const tableMeta = getTableMeta(BareString)!;
    const nameAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'name')!;
    expect(nameAttr.kind).toBe('string');
    expect(nameAttr.options).toEqual({});
  });

  it('NumberAttribute with no args (bare decorator)', () => {
    @DynamoTable('bare-number')
    class BareNumber {
      @StringAttribute({hashKey: true}) id!: string;

      @NumberAttribute()
      count!: number;
    }

    const tableMeta = getTableMeta(BareNumber)!;
    const countAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'count')!;
    expect(countAttr.kind).toBe('number');
    expect(countAttr.options).toEqual({});
  });

  it('BooleanAttribute with no args (bare decorator)', () => {
    @DynamoTable('bare-bool')
    class BareBool {
      @StringAttribute({hashKey: true}) id!: string;

      @BooleanAttribute()
      flag!: boolean;
    }

    const tableMeta = getTableMeta(BareBool)!;
    const flagAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'flag')!;
    expect(flagAttr.kind).toBe('boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Remaining branch-only gaps
// ─────────────────────────────────────────────────────────────────────────────

describe('Branch coverage — final gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DataSource.initialize() skips re-registering already-registered entity', async () => {
    const dynamooseModelSpy = vi.spyOn(dynamoose, 'model').mockReturnValue(makeMockDynamooseModel() as any);
    const dataSource = new DataSource({entities: [UserTable, UserTable]});
    await dataSource.initialize();
    expect(dynamooseModelSpy.mock.calls).toHaveLength(1);
  });

  it('@Attribute without alias uses propertyKey as attributeName', () => {
    @DynamoTable('attr-no-alias')
    class AttrNoAlias {
      @StringAttribute({hashKey: true}) id!: string;

      @Attribute({required: true})
      name!: string;
    }

    const tableMeta = getTableMeta(AttrNoAlias)!;
    const nameAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'name')!;
    expect(nameAttr.attributeName).toBe('name');
  });

  it('DateAttribute with no arguments uses empty options and no alias', () => {
    @DynamoTable('date-noargs')
    class DateNoArgs {
      @StringAttribute({hashKey: true}) id!: string;

      @DateAttribute()
      ts!: Date;
    }

    const tableMeta = getTableMeta(DateNoArgs)!;
    const tsAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'ts')!;
    expect(tsAttr.kind).toBe('date');
    expect(tsAttr.timestampType).toBeUndefined();
  });

  it('injectTimestampsDeep skips null elements inside an array', () => {
    const tableSchema = resolveTableSchema(AuditedOrderTable);
    const auditedOrderMockModel = makeMockDynamooseModel();
    const internalModel = new InternalModel(
      AuditedOrderTable,
      tableSchema,
      auditedOrderMockModel as unknown as ReturnType<typeof dynamoose.model>
    );
    const entityRecord: AnyRecord = {id: '1', items: [null, 'bad', 42]};
    expect(() => internalModel.injectCreateTimestamps(entityRecord)).not.toThrow();
  });

  it('#rootAttrs() returns [] when entity has no @DynamoTable metadata', () => {
    class Bare {}
    const borrowedSchema = resolveTableSchema(UserTable);
    const bareMockModel = makeMockDynamooseModel();
    const internalModel = new InternalModel(
      Bare as unknown as new () => UserTable,
      borrowedSchema,
      bareMockModel as unknown as ReturnType<typeof dynamoose.model>
    );
    const entityRecord: AnyRecord = {id: '1'};
    expect(() => internalModel.injectCreateTimestamps(entityRecord)).not.toThrow();
    expect(entityRecord['created_at']).toBeUndefined();
  });

  it('find() with withDeleted:true skips soft-delete filter', async () => {
    const deletedItemData = {id: '1', deleted_at: new Date()};
    const queryExecMock = vi
      .fn()
      .mockResolvedValue(Object.assign([{...deletedItemData, toJSON: () => deletedItemData}], {lastKey: undefined}));
    const queryChainMock = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: queryExecMock,
    };
    vi.spyOn(dynamoose, 'model').mockReturnValue({query: vi.fn().mockReturnValue(queryChainMock)} as any);
    const dataSource = new DataSource({entities: [UserTable]});
    await dataSource.initialize();
    const userRepository = dataSource.getRepository(UserTable);
    const findResult = await userRepository.find('u1', {withDeleted: true});
    expect(findResult.items).toHaveLength(1);
  });

  it('scan() with withDeleted:true skips soft-delete filter', async () => {
    const deletedItemData = {id: '1', deleted_at: new Date()};
    const scanExecMock = vi
      .fn()
      .mockResolvedValue(Object.assign([{...deletedItemData, toJSON: () => deletedItemData}], {lastKey: undefined}));
    vi.spyOn(dynamoose, 'model').mockReturnValue({
      scan: vi
        .fn()
        .mockReturnValue({limit: vi.fn().mockReturnThis(), startAt: vi.fn().mockReturnThis(), exec: scanExecMock}),
    } as any);
    const dataSource = new DataSource({entities: [UserTable]});
    await dataSource.initialize();
    const userRepository = dataSource.getRepository(UserTable);
    const scanResult = await userRepository.scan({withDeleted: true});
    expect(scanResult.items).toHaveLength(1);
  });

  it('count() with withDeleted:true skips soft-delete filter', async () => {
    const deletedItemData = {id: '1', deleted_at: new Date()};
    const countExecMock = vi
      .fn()
      .mockResolvedValue(Object.assign([{...deletedItemData, toJSON: () => deletedItemData}], {lastKey: undefined}));
    vi.spyOn(dynamoose, 'model').mockReturnValue({
      scan: vi
        .fn()
        .mockReturnValue({limit: vi.fn().mockReturnThis(), startAt: vi.fn().mockReturnThis(), exec: countExecMock}),
    } as any);
    const dataSource = new DataSource({entities: [UserTable]});
    await dataSource.initialize();
    const userRepository = dataSource.getRepository(UserTable);
    const countResult = await userRepository.count({withDeleted: true});
    expect(countResult).toBe(1);
  });

  it('resolveTableSchema with no hooks: tableOptions excludes _hooks and hooks', () => {
    @DynamoTable('no-hooks-table')
    class NoHooksTable {
      @StringAttribute({hashKey: true}) id!: string;
    }

    const tableSchema = resolveTableSchema(NoHooksTable);
    expect(tableSchema.tableOptions).not.toHaveProperty('_hooks');
    expect(tableSchema.tableOptions).not.toHaveProperty('hooks');
  });
});
