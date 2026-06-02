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

import {
  ArrayAttribute,
  BooleanAttribute,
  CreateDateAttribute,
  DateAttribute,
  DeleteDateAttribute,
  NestedAttribute,
  NumberAttribute,
  OptimisticLockError,
  SetAttribute,
  StringAttribute,
  UpdateDateAttribute,
  VersionAttribute,
  type Projected,
  type SelectMap,
} from '#';
import {DataSource} from '#/data-source/data-source';
import {Attribute} from '#/decorators/attribute.decorators';
import {DynamoDocument, DynamoTable, DynamoTable as DynamoTableClass} from '#/decorators/class.decorators';
import {getTableMeta} from '#/decorators/metadata.registry';
import {InternalModel} from '#/model/internal-model';
import {resolveTableSchema} from '#/schema';
import type {AnyRecord, FilterCondition} from '#/types';
import dynamoose from 'dynamoose';
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from 'vitest';
import {AuditedOrderTable, OrderTable, UserTable, VersionedTable} from './fixtures';

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

const makeMockDynamooseModel = (): MockDynamooseModel => {
  const queryChain: Record<string, any> = {
    eq: vi.fn().mockReturnThis(),
    ne: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    between: vi.fn().mockReturnThis(),
    beginsWith: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    exists: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    consistent: vi.fn().mockReturnThis(),
    startAt: vi.fn().mockReturnThis(),
    using: vi.fn().mockReturnThis(),
    attributes: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
    where: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      between: vi.fn().mockReturnThis(),
      beginsWith: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
    }),
  };
  queryChain['filter'] = vi.fn().mockReturnValue(queryChain);
  queryChain['not'] = vi.fn().mockReturnValue({eq: vi.fn(() => queryChain), exists: vi.fn(() => queryChain)});

  const scanChain: Record<string, any> = {
    limit: vi.fn().mockReturnThis(),
    startAt: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
    using: vi.fn().mockReturnThis(),
    attributes: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
  };
  scanChain['filter'] = vi.fn().mockReturnValue(scanChain);
  scanChain['not'] = vi.fn().mockReturnValue({eq: vi.fn(() => scanChain), exists: vi.fn(() => scanChain)});

  return {
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
    query: vi.fn().mockReturnValue(queryChain),
    scan: vi.fn().mockReturnValue(scanChain),
  };
};

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
      where: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        between: vi.fn().mockReturnThis(),
        beginsWith: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        consistent: vi.fn().mockReturnThis(),
        startAt: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
      }),
      limit: vi.fn().mockReturnThis(),
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      using: vi.fn().mockReturnThis(),
      attributes: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
    }),
    scan: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      using: vi.fn().mockReturnThis(),
      attributes: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
    }),
  };

  const mockTable = vi.fn();
  const mockAws = {ddb: {set: vi.fn(), local: vi.fn(), DynamoDB: (actual as any).aws?.ddb?.DynamoDB}};

  return {
    ...(actual as Record<string, unknown>),
    model: vi.fn().mockReturnValue(inlineBaselineMock),
    Schema: vi.fn(),
    Table: mockTable,
    aws: mockAws,
    transaction: vi.fn().mockResolvedValue(undefined),
    Instance: MockInstance,
    default: {
      model: vi.fn().mockReturnValue(inlineBaselineMock),
      Schema: vi.fn(),
      Table: mockTable,
      aws: mockAws,
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

  it('findByIndex() delegates to repository.findByIndex', async () => {
    const queryChain: Record<string, any> = {};
    for (const m of ['eq', 'using', 'limit', 'consistent', 'startAt']) {
      queryChain[m] = vi.fn().mockReturnValue(queryChain);
    }
    queryChain.exec = vi
      .fn()
      .mockResolvedValue(Object.assign([makeItem({id: '1', is_active: true})], {lastKey: undefined}));
    queryChain.filter = vi.fn().mockReturnValue(queryChain);
    const queryMock = vi.fn().mockReturnValue(queryChain);
    vi.spyOn(dynamoose, 'model').mockReturnValue({query: queryMock} as any);
    const dataSource = new DataSource({entities: [UserTable]});
    await dataSource.initialize();
    const entityManager = dataSource.manager;
    const result = await entityManager.findByIndex(UserTable, 'isActive', true);
    expect(result.items).toHaveLength(1);
  });

  it('findAll() delegates to repository.findAll', async () => {
    const queryChain: Record<string, any> = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
    };
    vi.spyOn(dynamoose, 'model').mockReturnValue({query: vi.fn().mockReturnValue(queryChain)} as any);
    const ds = new DataSource({entities: [UserTable]});
    await ds.initialize();
    const result = await ds.manager.findAll(UserTable, 'u1');
    expect(result).toHaveLength(0);
  });

  it('scanAll() delegates to repository.scanAll', async () => {
    const scanChain: Record<string, any> = {
      limit: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
    };
    vi.spyOn(dynamoose, 'model').mockReturnValue({scan: vi.fn().mockReturnValue(scanChain)} as any);
    const ds = new DataSource({entities: [UserTable]});
    await ds.initialize();
    const result = await ds.manager.scanAll(UserTable);
    expect(result).toHaveLength(0);
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

  it('toAttributeKey serializes Date value for DateAttribute epoch field', () => {
    @DynamoTable('ta-key-date')
    class DateFieldTable {
      @StringAttribute({hashKey: true}) id!: string;
      @DateAttribute('expires_at', {format: 'epoch'}) expiresAt!: Date;
    }
    const tableSchema = resolveTableSchema(DateFieldTable);
    const mockModel = makeMockDynamooseModel();
    const internalModel = new InternalModel(
      DateFieldTable,
      tableSchema,
      mockModel as unknown as ReturnType<typeof dynamoose.model>
    );
    const d = new Date('2024-01-01T00:00:00.000Z');
    const result = internalModel.toAttributeKey({id: '1', expiresAt: d});
    expect(result['expires_at']).toBe(d.getTime());
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

  it('DateAttribute with alias string and format option', () => {
    @DynamoTable('date-alias')
    class DateAlias {
      @StringAttribute({hashKey: true}) id!: string;

      @DateAttribute('start_date', {format: 'iso'})
      startDate!: Date;
    }

    const tableMeta = getTableMeta(DateAlias)!;
    const startDateAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'startDate')!;
    expect(startDateAttr.attributeName).toBe('start_date');
    expect(startDateAttr.timestampType).toBe('iso');
  });

  it('DateAttribute with only options object (no alias)', () => {
    @DynamoTable('date-opts-only')
    class DateOptsOnly {
      @StringAttribute({hashKey: true}) id!: string;

      @DateAttribute({format: 'epoch'})
      ts!: Date;
    }

    const tableMeta = getTableMeta(DateOptsOnly)!;
    const tsAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'ts')!;
    expect(tsAttr.timestampType).toBe('epoch');
  });

  it('DateAttribute with ttl: true sets timestampType to ttl', () => {
    @DynamoTable('date-ttl')
    class DateTtl {
      @StringAttribute({hashKey: true}) id!: string;

      @DateAttribute({ttl: true})
      expiresAt!: Date;
    }

    const tableMeta = getTableMeta(DateTtl)!;
    const expiresAtAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'expiresAt')!;
    expect(expiresAtAttr.timestampType).toBe('ttl');
  });

  it('CreateDateAttribute with only options object (no alias)', () => {
    @DynamoTable('create-opts')
    class CreateOpts {
      @StringAttribute({hashKey: true}) id!: string;

      @CreateDateAttribute({format: 'epoch'})
      createdAt!: Date;
    }

    const tableMeta = getTableMeta(CreateOpts)!;
    const createdAtAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'createdAt')!;
    expect(createdAtAttr.kind).toBe('createDate');
    expect(createdAtAttr.timestampType).toBe('epoch');
  });

  it('UpdateDateAttribute with alias string', () => {
    @DynamoTable('update-alias')
    class UpdateAlias {
      @StringAttribute({hashKey: true}) id!: string;

      @UpdateDateAttribute('updated_at', {format: 'iso'})
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

      @UpdateDateAttribute({})
      updatedAt!: Date;
    }

    const tableMeta = getTableMeta(UpdateOpts)!;
    const updatedAtAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'updatedAt')!;
    expect(updatedAtAttr.kind).toBe('updateDate');
    expect(updatedAtAttr.timestampType).toBe('epoch');
  });

  it('DeleteDateAttribute with alias string', () => {
    @DynamoTable('delete-alias')
    class DeleteAlias {
      @StringAttribute({hashKey: true}) id!: string;

      @DeleteDateAttribute('deleted_at')
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

      @DeleteDateAttribute({format: 'iso'})
      deletedAt!: Date | null;
    }

    const tableMeta = getTableMeta(DeleteOpts)!;
    const deletedAtAttr = tableMeta.attributes.find(attr => attr.propertyKey === 'deletedAt')!;
    expect(deletedAtAttr.kind).toBe('deleteDate');
    expect(deletedAtAttr.timestampType).toBe('iso');
  });

  it('DeleteDateAttribute with index:true creates GSI entry and deleteDateIndexName', () => {
    @DynamoTable('delete-gsi')
    class DeleteGsiTable {
      @StringAttribute({hashKey: true}) id!: string;

      @DeleteDateAttribute('deleted_at', {index: true})
      deletedAt!: Date | null;
    }

    const tableSchema = resolveTableSchema(DeleteGsiTable);
    expect((tableSchema.definition['deleted_at'] as any).index).toBe(true);
    expect(tableSchema.deleteDateIndexName).toBe('deleted_atGlobalIndex');
  });

  it('CreateDateAttribute with index:true adds GSI to schema definition', () => {
    @DynamoTable('create-gsi')
    class CreateGsiTable {
      @StringAttribute({hashKey: true}) id!: string;

      @CreateDateAttribute('created_at', {index: true})
      createdAt!: Date;
    }

    const tableSchema = resolveTableSchema(CreateGsiTable);
    expect((tableSchema.definition['created_at'] as any).index).toBe(true);
  });

  it('UpdateDateAttribute with index:true adds GSI to schema definition', () => {
    @DynamoTable('update-gsi')
    class UpdateGsiTable {
      @StringAttribute({hashKey: true}) id!: string;

      @UpdateDateAttribute('updated_at', {index: true})
      updatedAt!: Date;
    }

    const tableSchema = resolveTableSchema(UpdateGsiTable);
    expect((tableSchema.definition['updated_at'] as any).index).toBe(true);
  });

  it('DeleteDateAttribute without index:true leaves deleteDateIndexName undefined', () => {
    const tableSchema = resolveTableSchema(UserTable);
    expect(tableSchema.deleteDateIndexName).toBeUndefined();
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

  it('DataSource with global throughput passes throughput to Table constructor', async () => {
    vi.spyOn(dynamoose, 'model').mockReturnValue(makeMockDynamooseModel() as any);
    const dataSource = new DataSource({
      entities: [UserTable],
      table: {throughput: 'ON_DEMAND'},
    });
    await dataSource.initialize();
    expect(dataSource.isInitialized).toBe(true);
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
    expect(tsAttr.timestampType).toBe('epoch');
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

  it('count() with withDeleted:true uses Select: COUNT (no item bodies)', async () => {
    const countExecMock = vi.fn().mockResolvedValue({count: 1, scannedCount: 1});
    vi.spyOn(dynamoose, 'model').mockReturnValue({
      scan: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnThis(),
        startAt: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        exec: countExecMock,
      }),
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

// ─────────────────────────────────────────────────────────────────────────────
// @VersionAttribute + OptimisticLockError
// ─────────────────────────────────────────────────────────────────────────────

describe('@VersionAttribute and optimistic locking', () => {
  afterEach(() => vi.restoreAllMocks());

  it('OptimisticLockError has correct name and message', () => {
    const err = new OptimisticLockError({id: '1'});
    expect(err.name).toBe('OptimisticLockError');
    expect(err.message).toContain('Optimistic lock conflict');
    expect(err.message).toContain('"id"');
  });

  it('OptimisticLockError without key omits key from message', () => {
    const err = new OptimisticLockError();
    expect(err.message).not.toContain('Key:');
  });

  it('resolveTableSchema detects versionKey and versionAttrName', () => {
    const schema = resolveTableSchema(VersionedTable);
    expect(schema.versionKey).toBe('version');
    expect(schema.versionAttrName).toBe('version');
    expect((schema.definition['version'] as Record<string, unknown>)['type']).toBe(Number);
    expect((schema.definition['version'] as Record<string, unknown>)['default']).toBe(0);
  });

  it('resolveTableSchema with aliased @VersionAttribute sets versionAttrName correctly', () => {
    @DynamoTable('v-alias-table')
    class VAliasTable {
      @StringAttribute({hashKey: true}) id!: string;
      @VersionAttribute('v')
      version!: number;
    }
    const schema = resolveTableSchema(VAliasTable);
    expect(schema.versionKey).toBe('version');
    expect(schema.versionAttrName).toBe('v');
  });

  it('save() on versioned entity calls create with overwrite:false', async () => {
    const mockModel = makeMockDynamooseModel();
    vi.spyOn(dynamoose, 'model').mockReturnValue(mockModel as any);
    const ds = new DataSource({entities: [VersionedTable]});
    await ds.initialize();
    const repo = ds.getRepository(VersionedTable);
    await repo.save({id: '1', name: 'Alice', version: 0});
    expect(mockModel.create).toHaveBeenCalledWith(
      expect.objectContaining({id: '1'}),
      expect.objectContaining({overwrite: false})
    );
  });

  it('update() with version in changes builds condition and increments version', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.update.mockResolvedValue({id: '1', name: 'Bob', version: 1});
    vi.spyOn(dynamoose, 'model').mockReturnValue(mockModel as any);
    const ds = new DataSource({entities: [VersionedTable]});
    await ds.initialize();
    const repo = ds.getRepository(VersionedTable);
    const result = await repo.update({id: '1'}, {name: 'Bob', version: 0} as Partial<VersionedTable>);
    expect(mockModel.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({version: 1}),
      expect.objectContaining({condition: expect.anything()})
    );
    expect(result).toBeDefined();
  });

  it('update() with version in changes throws OptimisticLockError on ConditionalCheckFailedException', async () => {
    const mockModel = makeMockDynamooseModel();
    const condError = Object.assign(new Error('condition failed'), {name: 'ConditionalCheckFailedException'});
    mockModel.update.mockRejectedValue(condError);
    vi.spyOn(dynamoose, 'model').mockReturnValue(mockModel as any);
    const ds = new DataSource({entities: [VersionedTable]});
    await ds.initialize();
    const repo = ds.getRepository(VersionedTable);
    await expect(repo.update({id: '1'}, {name: 'Bob', version: 0} as Partial<VersionedTable>)).rejects.toThrow(
      OptimisticLockError
    );
  });

  it('update() re-throws non-ConditionalCheckFailedException errors', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.update.mockRejectedValue(new Error('some other error'));
    vi.spyOn(dynamoose, 'model').mockReturnValue(mockModel as any);
    const ds = new DataSource({entities: [VersionedTable]});
    await ds.initialize();
    const repo = ds.getRepository(VersionedTable);
    await expect(repo.update({id: '1'}, {name: 'Bob', version: 0} as Partial<VersionedTable>)).rejects.toThrow(
      'some other error'
    );
  });

  it('update() without version in changes does not add condition', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.update.mockResolvedValue({id: '1', name: 'Bob', version: 0});
    vi.spyOn(dynamoose, 'model').mockReturnValue(mockModel as any);
    const ds = new DataSource({entities: [VersionedTable]});
    await ds.initialize();
    const repo = ds.getRepository(VersionedTable);
    await repo.update({id: '1'}, {name: 'Bob'} as Partial<VersionedTable>);
    expect(mockModel.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({name: 'Bob'}), undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Projection (SelectMap / Projected)
// ─────────────────────────────────────────────────────────────────────────────

describe('Projection expressions (select option)', () => {
  afterEach(() => vi.restoreAllMocks());

  const makeRepo = async (mockModel: MockDynamooseModel) => {
    vi.spyOn(dynamoose, 'model').mockReturnValue(mockModel as any);
    const ds = new DataSource({entities: [UserTable, OrderTable]});
    await ds.initialize();
    return ds.getRepository(UserTable);
  };

  it('find() without select returns full items (projectItem identity path)', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', name: 'Alice', age: 30});
    mockModel.query.mockReturnValue({
      ...mockModel.query(),
      exec: vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined})),
    });
    const repo = await makeRepo(mockModel);
    const result = await repo.find('u1');
    expect(result.items[0]).toMatchObject({id: 'u1', name: 'Alice', age: 30});
  });

  it('find() with select projects items to selected keys', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', name: 'Alice', age: 30});
    const chain = makeMockDynamooseModel().query();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined}));
    mockModel.query.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    const result = await repo.find('u1', {select: {id: true, name: true} as SelectMap<UserTable>});
    expect(result.items[0]).toEqual({id: 'u1', name: 'Alice'});
    expect((result.items[0] as any).age).toBeUndefined();
    expect(chain.attributes).toHaveBeenCalledWith(expect.arrayContaining(['id', 'name']));
  });

  it('find() with select + soft-delete injects deletedAt attr into projection', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', name: 'Alice', age: 30, deleted_at: null});
    const chain = makeMockDynamooseModel().query();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined}));
    mockModel.query.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    // UserTable has @DeleteDateAttribute('deleted_at') so soft-delete is active
    const result = await repo.find('u1', {select: {id: true, name: true} as SelectMap<UserTable>});
    // attributes() called with id, name AND deleted_at injected
    expect(chain.attributes).toHaveBeenCalledWith(expect.arrayContaining(['deleted_at']));
    // deleted_at not in final projection (only id, name)
    expect(result.items[0]).toEqual({id: 'u1', name: 'Alice'});
  });

  it('find() with select + soft-delete does not double-inject deletedAt when already selected', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', deleted_at: null});
    const chain = makeMockDynamooseModel().query();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined}));
    mockModel.query.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    await repo.find('u1', {select: {id: true, deletedAt: true} as SelectMap<UserTable>});
    const attrCall = (chain.attributes as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string[];
    // deleted_at must appear exactly once
    expect(attrCall.filter((a: string) => a === 'deleted_at')).toHaveLength(1);
  });

  it('scan() with select projects items', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', name: 'Alice', age: 30});
    const chain = makeMockDynamooseModel().scan();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined}));
    mockModel.scan.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    const result = await repo.scan({select: {id: true} as SelectMap<UserTable>});
    expect(result.items[0]).toEqual({id: 'u1'});
    expect(chain.attributes).toHaveBeenCalledWith(expect.arrayContaining(['id']));
  });

  it('scan() with select + soft-delete injects deletedAt attr', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', deleted_at: null});
    const chain = makeMockDynamooseModel().scan();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined}));
    mockModel.scan.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    await repo.scan({select: {id: true} as SelectMap<UserTable>});
    expect(chain.attributes).toHaveBeenCalledWith(expect.arrayContaining(['deleted_at']));
  });

  it('scan() with select + soft-delete does not double-inject deletedAt', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', deleted_at: null});
    const chain = makeMockDynamooseModel().scan();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined}));
    mockModel.scan.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    await repo.scan({select: {id: true, deletedAt: true} as SelectMap<UserTable>});
    const attrCall = (chain.attributes as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string[];
    expect(attrCall.filter((a: string) => a === 'deleted_at')).toHaveLength(1);
  });

  it('findByIndex() with select projects items', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', name: 'Alice', age: 30});
    const chain = makeMockDynamooseModel().query();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined}));
    mockModel.query.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    const result = await repo.findByIndex('name' as keyof UserTable & string, 'Alice', {
      select: {id: true} as SelectMap<UserTable>,
    });
    expect(result.items[0]).toEqual({id: 'u1'});
    expect(chain.attributes).toHaveBeenCalled();
  });

  it('findByIndex() with select + soft-delete injects deletedAt attr', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', deleted_at: null});
    const chain = makeMockDynamooseModel().query();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined}));
    mockModel.query.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    await repo.findByIndex('name' as keyof UserTable & string, 'Alice', {
      select: {id: true} as SelectMap<UserTable>,
    });
    expect(chain.attributes).toHaveBeenCalledWith(expect.arrayContaining(['deleted_at']));
  });

  it('findByIndex() with select + soft-delete does not double-inject deletedAt', async () => {
    const mockModel = makeMockDynamooseModel();
    const item = makeItem({id: 'u1', deleted_at: null});
    const chain = makeMockDynamooseModel().query();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([item], {lastKey: undefined}));
    mockModel.query.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    await repo.findByIndex('name' as keyof UserTable & string, 'Alice', {
      select: {id: true, deletedAt: true} as SelectMap<UserTable>,
    });
    const attrCall = (chain.attributes as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string[];
    expect(attrCall.filter((a: string) => a === 'deleted_at')).toHaveLength(1);
  });

  it('find() with select + withDeleted:true skips deletedAt injection', async () => {
    const mockModel = makeMockDynamooseModel();
    const chain = makeMockDynamooseModel().query();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    mockModel.query.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    await repo.find('u1', {select: {id: true} as SelectMap<UserTable>, withDeleted: true});
    const attrCall = (chain.attributes as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string[];
    expect(attrCall).not.toContain('deleted_at');
  });

  it('scan() with select + withDeleted:true skips deletedAt injection', async () => {
    const mockModel = makeMockDynamooseModel();
    const chain = makeMockDynamooseModel().scan();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    mockModel.scan.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    await repo.scan({select: {id: true} as SelectMap<UserTable>, withDeleted: true});
    const attrCall = (chain.attributes as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string[];
    expect(attrCall).not.toContain('deleted_at');
  });

  it('findByIndex() with select + withDeleted:true skips deletedAt injection', async () => {
    const mockModel = makeMockDynamooseModel();
    const chain = makeMockDynamooseModel().query();
    chain.exec = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    mockModel.query.mockReturnValue(chain);
    const repo = await makeRepo(mockModel);
    await repo.findByIndex('name' as keyof UserTable & string, 'Alice', {
      select: {id: true} as SelectMap<UserTable>,
      withDeleted: true,
    });
    const attrCall = (chain.attributes as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string[];
    expect(attrCall).not.toContain('deleted_at');
  });

  it('Projected type narrows return type at compile time', () => {
    type P = Projected<UserTable, {id: true; name: true}>;
    const item: P = {id: 'u1', name: 'Alice'};
    expect(item.id).toBe('u1');
    // @ts-expect-error age not in projection
    void item.age;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Condition expressions on writes (WriteOptions)
// ─────────────────────────────────────────────────────────────────────────────

describe('Condition expressions on writes (WriteOptions)', () => {
  afterEach(() => vi.restoreAllMocks());

  const makeUserRepo = async (mockModel: MockDynamooseModel) => {
    vi.spyOn(dynamoose, 'model').mockReturnValue(mockModel as any);
    const ds = new DataSource({entities: [UserTable]});
    await ds.initialize();
    return ds.getRepository(UserTable);
  };

  const makeVersionedRepo = async (mockModel: MockDynamooseModel) => {
    vi.spyOn(dynamoose, 'model').mockReturnValue(mockModel as any);
    const ds = new DataSource({entities: [VersionedTable]});
    await ds.initialize();
    return ds.getRepository(VersionedTable);
  };

  it('save() with condition (eq, ne, lt) calls create with condition object', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.create.mockResolvedValue({id: 'u1', name: 'Alice', age: 30});
    const repo = await makeUserRepo(mockModel);
    await repo.save({id: 'u1', name: 'Alice', age: 30} as UserTable, {
      condition: {id: {eq: 'u1'}, name: {ne: 'Bob'}, age: {lt: 100}},
    });
    expect(mockModel.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({condition: expect.anything()})
    );
  });

  it('save() with condition (lte, gt, gte) calls create with condition', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.create.mockResolvedValue({id: 'u1', name: 'Alice', age: 30});
    const repo = await makeUserRepo(mockModel);
    await repo.save({id: 'u1', name: 'Alice', age: 30} as UserTable, {
      condition: {age: {lte: 99}},
    });
    expect(mockModel.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({condition: expect.anything()})
    );
    // separate calls for gt and gte branches
    const repo2 = await makeUserRepo(makeMockDynamooseModel());
    await repo2.save({id: 'u2', name: 'Bob', age: 1} as UserTable, {condition: {age: {gt: 0}}});
    const repo3 = await makeUserRepo(makeMockDynamooseModel());
    await repo3.save({id: 'u3', name: 'Carol', age: 1} as UserTable, {condition: {age: {gte: 1}}});
  });

  it('save() with condition (between, beginsWith, contains)', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.create.mockResolvedValue({id: 'u1', name: 'Alice', age: 30});
    const repo = await makeUserRepo(mockModel);
    await repo.save({id: 'u1', name: 'Alice', age: 30} as UserTable, {
      condition: {age: {between: [18, 65]}, name: {beginsWith: 'Al'}, id: {contains: '1'}},
    });
    expect(mockModel.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({condition: expect.anything()})
    );
  });

  it('save() with condition (exists=true, exists=false, in)', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.create.mockResolvedValue({id: 'u1', name: 'Alice', age: 30});
    const repo = await makeUserRepo(mockModel);
    await repo.save({id: 'u1', name: 'Alice', age: 30} as UserTable, {
      condition: {name: {exists: true}, id: {in: ['u1', 'u2']}},
    });
    expect(mockModel.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({condition: expect.anything()})
    );
    // exists=false branch
    const repo2 = await makeUserRepo(makeMockDynamooseModel());
    await repo2.save({id: 'u2', name: 'Bob', age: 1} as UserTable, {condition: {id: {exists: false}}});
  });

  it('save() with condition + versionKey merges overwrite:false and condition', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.create.mockResolvedValue({id: '1', name: 'x', version: 0});
    const repo = await makeVersionedRepo(mockModel);
    await repo.save({id: '1', name: 'x', version: 0}, {condition: {name: {eq: 'x'}}});
    expect(mockModel.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({overwrite: false, condition: expect.anything()})
    );
  });

  it('update() with condition (no version) passes condition to update', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.update.mockResolvedValue({id: 'u1', name: 'Alice', age: 30});
    const repo = await makeUserRepo(mockModel);
    await repo.update({id: 'u1'}, {name: 'Alice'} as Partial<UserTable>, {
      condition: {name: {eq: 'Old'}},
    });
    expect(mockModel.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({condition: expect.anything()})
    );
  });

  it('buildCondition: empty condition entry hits final else-if false path', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.create.mockResolvedValue({id: 'u1', name: 'Alice', age: 30});
    const repo = await makeUserRepo(mockModel);
    // empty FilterCondition — no operator set; loop runs but all branches false
    await repo.save({id: 'u1', name: 'Alice', age: 30} as UserTable, {
      condition: {id: {} as FilterCondition},
    });
    expect(mockModel.create).toHaveBeenCalled();
  });

  it('update() with condition + version merges both conditions (base path in buildCondition)', async () => {
    const mockModel = makeMockDynamooseModel();
    mockModel.update.mockResolvedValue({id: '1', name: 'x', version: 1});
    const repo = await makeVersionedRepo(mockModel);
    await repo.update({id: '1'}, {name: 'x', version: 0} as Partial<VersionedTable>, {
      condition: {name: {eq: 'old'}},
    });
    expect(mockModel.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({version: 1}),
      expect.objectContaining({condition: expect.anything()})
    );
  });
});
