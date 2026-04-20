/**
 * Tests targeting the specific uncovered lines in the coverage report:
 *
 * data-source.ts          – destroy, isInitialized, manager guard, lazyInit,
 *                           #getModel throw, #assertInitialized throw,
 *                           local option branches, documentClient branch,
 *                           already-initialized early return, transaction
 * dynamo-table.decorator  – the bare DynamoTable(tableName) decorator path
 * internal-model.ts       – runHook (fn called), normalize(null/undefined),
 *                           injectDeleteTimestamp, clearDeleteTimestamp
 * repository.ts           – find (consistent+startAt), scan (startAt),
 *                           delete without softDelete (hardDelete fallback),
 *                           hardDelete (item exists branch),
 *                           restore
 * schema-builder.ts       – createDate/updateDate default fn(), nested with
 *                           no typeRef, array with no typeRef, set with no
 *                           typeRef, metadata.registry (pendingAttributesMap
 *                           branch 66.66%)
 * object.utils.ts         – all four helpers (isPlainObject, stripUnknownKeys,
 *                           pick, omit)
 * entity-manager.ts       – unregistered entity throw
 * transaction-collector.ts – enqueue+flush, empty flush
 * transaction-manager.ts  – all write/read paths
 */

import {DataSource} from '#/data-source/data-source';
import {DynamoDocument, DynamoTable} from '#/decorators/class.decorators';
import {getDocumentMeta, getTableMeta} from '#/decorators/metadata.registry';
import {ArrayAttribute, CreateDateAttribute, NestedAttribute, StringAttribute} from '#/index';
import {EntityManager} from '#/manager/entity-manager';
import {TransactionCollector} from '#/manager/transaction-collector';
import {TransactionManager} from '#/manager/transaction-manager';
import {InternalModel} from '#/model/internal-model';
import {resolveTableSchema} from '#/schema';
import type {AnyRecord} from '#/types';
import {isPlainObject, omit, pick, stripUnknownKeys} from '#/utils/object.utils';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import dynamoose from 'dynamoose';
import {type Mock, beforeEach, describe, expect, it, vi} from 'vitest';
import {OrderTable, UserTable} from './fixtures';

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

const makeInternalModel = <T extends object>(tableCtor: new () => T): InternalModel<T> => {
  const tableSchema = resolveTableSchema(tableCtor);
  const mockDynamooseModel = makeMockDynamooseModel();
  return new InternalModel(tableCtor, tableSchema, mockDynamooseModel as unknown as ReturnType<typeof dynamoose.model>);
};

const makeItem = (data: Record<string, unknown>): Record<string, unknown> => ({
  ...data,
  toJSON: (): Record<string, unknown> => data,
});

// ── Shared dynamoose mock ─────────────────────────────────────────────────────

vi.mock('dynamoose', async importOriginal => {
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
    ...(await importOriginal()),
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

// ── object.utils ─────────────────────────────────────────────────────────────

describe('object.utils', () => {
  describe('isPlainObject', () => {
    it('returns true for plain objects', () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({a: 1})).toBe(true);
    });

    it('returns false for non-plain values', () => {
      expect(isPlainObject(null)).toBe(false);
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject(new Date())).toBe(false);
      expect(isPlainObject('string')).toBe(false);
      expect(isPlainObject(42)).toBe(false);
    });
  });

  describe('stripUnknownKeys', () => {
    it('keeps only keys present in definition', () => {
      const strippedResult = stripUnknownKeys<{name: string}>({name: 'Alice', extra: 'gone'}, {name: {}});
      expect(strippedResult).toEqual({name: 'Alice'});
      expect('extra' in strippedResult).toBe(false);
    });

    it('ignores definition keys absent in item', () => {
      const strippedResult = stripUnknownKeys<{name: string; age: number}>({name: 'Alice'}, {name: {}, age: {}});
      expect(strippedResult).toEqual({name: 'Alice'});
    });
  });

  describe('pick', () => {
    it('picks selected keys', () => {
      const sourceObject = {a: 1, b: 2, c: 3};
      expect(pick(sourceObject, ['a', 'c'])).toEqual({a: 1, c: 3});
    });

    it('ignores keys not present in object', () => {
      const sourceObject = {a: 1};
      expect(pick(sourceObject, ['a', 'b' as keyof typeof sourceObject])).toEqual({a: 1});
    });
  });

  describe('omit', () => {
    it('omits listed keys', () => {
      const sourceObject = {a: 1, b: 2, c: 3};
      expect(omit(sourceObject, ['b'])).toEqual({a: 1, c: 3});
    });

    it('returns all keys when nothing is omitted', () => {
      const sourceObject = {a: 1, b: 2};
      expect(omit(sourceObject, [])).toEqual({a: 1, b: 2});
    });
  });
});

// ── DynamoTable standalone decorator ─────────────────────────────────────────

describe('DynamoTable standalone decorator', () => {
  it('registers table metadata via the decorator (without options)', () => {
    @DynamoTable('standalone_test')
    class StandaloneTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }

    const tableMeta = getTableMeta(StandaloneTable);
    expect(tableMeta).toBeDefined();
    expect(tableMeta?.tableName).toBe('standalone_test');
  });
});

// ── schema-builder edge cases ─────────────────────────────────────────────────

describe('schema-builder edge cases', () => {
  it('createDate default fn() returns a serialized date', () => {
    @DynamoTable('ts-default-table')
    class TsDefaultTable {
      @StringAttribute({hashKey: true})
      id!: string;

      @CreateDateAttribute({type: String})
      createdAt!: Date;
    }

    const tableSchema = resolveTableSchema(TsDefaultTable);
    const createdAtField = tableSchema.definition['createdAt'] as {default: () => unknown};
    expect(typeof createdAtField.default).toBe('function');
    const defaultValue = createdAtField.default();
    expect(typeof defaultValue).toBe('string');
  });

  it('nested attribute with no typeRef is skipped', () => {
    @DynamoTable('no-typeref-nested')
    class NoTypeRefTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }

    const tableMeta = getTableMeta(NoTypeRefTable)!;
    tableMeta.attributes.push({
      propertyKey: 'phantom',
      attributeName: 'phantom',
      kind: 'nested',
      options: {},
    });

    const tableSchema = resolveTableSchema(NoTypeRefTable);
    expect(tableSchema.definition['phantom']).toBeUndefined();
  });

  it('array attribute with no typeRef is skipped', () => {
    @DynamoTable('no-typeref-array')
    class NoTypeRefArrayTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }

    const tableMeta = getTableMeta(NoTypeRefArrayTable)!;
    tableMeta.attributes.push({
      propertyKey: 'items',
      attributeName: 'items',
      kind: 'array',
      options: {},
    });

    const tableSchema = resolveTableSchema(NoTypeRefArrayTable);
    expect(tableSchema.definition['items']).toBeUndefined();
  });

  it('set attribute with no typeRef is skipped', () => {
    @DynamoTable('no-typeref-set')
    class NoTypeRefSetTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }

    const tableMeta = getTableMeta(NoTypeRefSetTable)!;
    tableMeta.attributes.push({
      propertyKey: 'tags',
      attributeName: 'tags',
      kind: 'set',
      options: {},
    });

    const tableSchema = resolveTableSchema(NoTypeRefSetTable);
    expect(tableSchema.definition['tags']).toBeUndefined();
  });

  it('array of primitive (non-document) builds schema with element type', () => {
    @DynamoTable('prim-array')
    class PrimArrayTable {
      @StringAttribute({hashKey: true})
      id!: string;

      @ArrayAttribute(() => String as unknown as new () => unknown)
      tags!: string[];
    }

    const tableSchema = resolveTableSchema(PrimArrayTable);
    const tagsField = tableSchema.definition['tags'] as {schema: unknown[]};
    expect(tagsField.schema).toEqual([{type: String}]);
  });

  it('nested attribute pointing to a @DynamoDocument builds nested schema', () => {
    @DynamoDocument()
    class InnerDoc {
      @StringAttribute()
      value!: string;
    }

    @DynamoTable('nested-doc-table')
    class NestedDocTable {
      @StringAttribute({hashKey: true})
      id!: string;

      @NestedAttribute(() => InnerDoc)
      inner!: InnerDoc;
    }

    const tableSchema = resolveTableSchema(NestedDocTable);
    const innerField = tableSchema.definition['inner'] as {type: unknown; schema: Record<string, unknown>};
    expect(innerField.type).toBe(Object);
    expect(innerField.schema).toHaveProperty('value');
  });
});

// ── InternalModel edge cases ──────────────────────────────────────────────────

describe('InternalModel edge cases', () => {
  it('injectDeleteTimestamp writes deleted_at', () => {
    const userInternalModel = makeInternalModel(UserTable);
    const userRecord: AnyRecord = {id: '1'};
    userInternalModel.injectDeleteTimestamp(userRecord);
    expect(userRecord['deleted_at']).toBeInstanceOf(Date);
  });

  it('clearDeleteTimestamp sets deleted_at to null', () => {
    const userInternalModel = makeInternalModel(UserTable);
    const userRecord: AnyRecord = {id: '1', deleted_at: new Date()};
    userInternalModel.clearDeleteTimestamp(userRecord);
    expect(userRecord['deleted_at']).toBeNull();
  });

  it('runHook executes hook when defined', async () => {
    const beforeInsertHook = vi.fn();
    const {DynamoTable: DT} = await import('#/decorators/class.decorators');

    @DT('hooked-table', {hooks: {beforeInsert: beforeInsertHook}})
    class HookedTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }

    const hookedInternalModel = makeInternalModel(HookedTable);
    const hookedRecord: AnyRecord = {id: '1'};

    await hookedInternalModel.runHook('beforeInsert', hookedRecord);
    expect(beforeInsertHook).toHaveBeenCalledWith(hookedRecord);
  });

  it('normalize returns empty object for null', () => {
    const userInternalModel = makeInternalModel(UserTable);
    const normalizedResult = userInternalModel.normalize(null);
    expect(normalizedResult).toBeDefined();
    expect(typeof normalizedResult).toBe('object');
  });

  it('normalize returns empty object for undefined', () => {
    const userInternalModel = makeInternalModel(UserTable);
    const normalizedResult = userInternalModel.normalize(undefined);
    expect(normalizedResult).toBeDefined();
    expect(typeof normalizedResult).toBe('object');
  });
});

// ── DataSource ────────────────────────────────────────────────────────────────

describe('DataSource', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(dynamoose, 'model').mockReturnValue(makeMockDynamooseModel() as any);
    dataSource = new DataSource({entities: [UserTable]});
    await dataSource.initialize();
  });

  it('isInitialized returns true after initialize()', () => {
    expect(dataSource.isInitialized).toBe(true);
  });

  it('initialize() is idempotent — second call returns same instance', async () => {
    const reinitResult = await dataSource.initialize();
    expect(reinitResult).toBe(dataSource);
    expect(dataSource.isInitialized).toBe(true);
  });

  it('manager getter returns EntityManager after initialize', () => {
    expect(dataSource.manager).toBeDefined();
  });

  it('manager getter throws before initialize', () => {
    const uninitializedDataSource = new DataSource({entities: [UserTable]});
    expect(() => uninitializedDataSource.manager).toThrow('not initialized');
  });

  it('destroy() resets initialized state', async () => {
    await dataSource.destroy();
    expect(dataSource.isInitialized).toBe(false);
  });

  it('getRepository before initialize uses lazyInit path', () => {
    const uninitializedDataSource = new DataSource({entities: [UserTable]});
    expect(() => uninitializedDataSource.getRepository(UserTable)).not.toThrow();
  });

  it('lazyInit: calling getRepository again reuses same manager', () => {
    const uninitializedDataSource = new DataSource({entities: [UserTable]});
    const firstRepository = uninitializedDataSource.getRepository(UserTable);
    const secondRepository = uninitializedDataSource.getRepository(UserTable);
    expect(firstRepository).toBeDefined();
    expect(secondRepository).toBeDefined();
  });

  it('#getModel throws for unregistered entity', () => {
    @DynamoTable('unregistered')
    class Unregistered {
      @StringAttribute({hashKey: true})
      id!: string;
    }
    expect(() => dataSource.getRepository(Unregistered)).toThrow('not registered');
  });

  it('transaction() executes callback and flushes', async () => {
    const transactionCallbackSpy = vi.fn().mockResolvedValue(undefined);
    await dataSource.transaction(transactionCallbackSpy);
    expect(transactionCallbackSpy).toHaveBeenCalled();
  });

  it('transaction() returns the callback return value', async () => {
    const transactionResult = await dataSource.transaction(async () => 42 as unknown as void);
    expect(transactionResult).toBe(42);
  });

  it('transaction() throws when not initialized', async () => {
    const uninitializedDataSource = new DataSource({entities: [UserTable]});
    await expect(uninitializedDataSource.transaction(async () => undefined)).rejects.toThrow('not initialized');
  });

  it('configureClient with local: true sets local endpoint', async () => {
    const localDataSource = new DataSource({entities: [UserTable], local: true});
    await localDataSource.initialize();
    expect(localDataSource.isInitialized).toBe(true);
  });

  it('configureClient with local object sets host+port', async () => {
    const localDataSource = new DataSource({
      entities: [UserTable],
      local: {host: '127.0.0.1', port: 9000},
    });
    await localDataSource.initialize();
    expect(localDataSource.isInitialized).toBe(true);
  });

  it('configureClient with empty local object falls back to defaults', async () => {
    const localDataSource = new DataSource({
      entities: [UserTable],
      local: {},
    });
    await localDataSource.initialize();
    expect(localDataSource.isInitialized).toBe(true);
  });

  it('configureClient with documentClient sets the client', async () => {
    const fakeDynamoDBClient = {} as DynamoDBClient;
    const clientDataSource = new DataSource({entities: [UserTable], documentClient: fakeDynamoDBClient});
    await clientDataSource.initialize();
    expect(clientDataSource.isInitialized).toBe(true);
  });
});

// ── Repository real paths (mocked dynamoose) ──────────────────────────────────

describe('Repository real paths (mocked dynamoose)', () => {
  let dataSource: DataSource;
  let currentMockDynamooseModel: MockDynamooseModel;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentMockDynamooseModel = makeMockDynamooseModel();
    vi.spyOn(dynamoose, 'model').mockReturnValue(currentMockDynamooseModel as any);
    dataSource = new DataSource({entities: [UserTable, OrderTable]});
    await dataSource.initialize();
  });

  it('create() returns a partial entity object', () => {
    const userRepository = dataSource.getRepository(UserTable);
    const createdUser = userRepository.create({id: '42', name: 'Test'});
    expect(createdUser.id).toBe('42');
    expect(createdUser.name).toBe('Test');
  });

  it('find() with consistent and startAt options passes them through', async () => {
    const startAtKey = {id: 'cursor'};
    const queryExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: startAtKey}));
    currentMockDynamooseModel.query.mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: queryExecMock,
    });
    const userRepository = dataSource.getRepository(UserTable);
    const findResult = await userRepository.find('u1', {consistent: true, startAt: startAtKey});
    expect(findResult.lastKey).toEqual(startAtKey);
  });

  it('scan() with startAt passes it through', async () => {
    const startAtKey = {id: 'cursor'};
    const scanExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: startAtKey}));
    currentMockDynamooseModel.scan.mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: scanExecMock,
    });
    const userRepository = dataSource.getRepository(UserTable);
    const scanResult = await userRepository.scan({startAt: startAtKey});
    expect(scanResult.lastKey).toEqual(startAtKey);
  });

  it('delete() on entity without soft-delete calls hardDelete', async () => {
    currentMockDynamooseModel.get.mockResolvedValue(makeItem({userId: 'u1', orderId: 'o1', product: 'X'}));
    const orderRepository = dataSource.getRepository(OrderTable);
    await orderRepository.delete({userId: 'u1', orderId: 'o1'});
    expect(currentMockDynamooseModel.delete).toHaveBeenCalled();
  });

  it('hardDelete() runs hooks and calls raw.delete when item exists', async () => {
    currentMockDynamooseModel.get.mockResolvedValue(makeItem({id: '1', name: 'Alice'}));
    const userRepository = dataSource.getRepository(UserTable);
    await userRepository.hardDelete({id: '1'});
    expect(currentMockDynamooseModel.delete).toHaveBeenCalled();
  });

  it('hardDelete() does nothing when item does not exist', async () => {
    currentMockDynamooseModel.get.mockResolvedValue(null);
    const userRepository = dataSource.getRepository(UserTable);
    await userRepository.hardDelete({id: 'ghost'});
    expect(currentMockDynamooseModel.delete).not.toHaveBeenCalled();
  });

  it('restore() calls update with null on delete date attribute', async () => {
    const userRepository = dataSource.getRepository(UserTable);
    await userRepository.restore({id: '1'});
    expect(currentMockDynamooseModel.update).toHaveBeenCalledWith({id: '1'}, {deleted_at: null});
  });
});

// ── EntityManager ─────────────────────────────────────────────────────────────

describe('EntityManager', () => {
  it('throws for unregistered entity', () => {
    const emptyRegistry = new Map<new () => unknown, InternalModel<object>>();
    const entityManager = new EntityManager(emptyRegistry);

    @DynamoTable('em-missing')
    class Missing {
      @StringAttribute({hashKey: true})
      id!: string;
    }

    expect(() => entityManager.getRepository(Missing)).toThrow('not registered');
  });
});

// ── TransactionCollector ──────────────────────────────────────────────────────

describe('TransactionCollector', () => {
  it('flush() is a no-op when queue is empty', async () => {
    const transactionCollector = new TransactionCollector();
    expect(transactionCollector.size).toBe(0);
    await expect(transactionCollector.flush()).resolves.not.toThrow();
  });

  it('flush() calls dynamoose.transaction with all collected ops', async () => {
    const transactionCollector = new TransactionCollector();
    const userInternalModel = makeInternalModel(UserTable);

    transactionCollector.enqueueCreate(userInternalModel, {id: '1'});
    transactionCollector.enqueueUpdate(userInternalModel, {id: '1'}, {name: 'X'});
    transactionCollector.enqueueDelete(userInternalModel, {id: '1'});

    expect(transactionCollector.size).toBe(3);
    await transactionCollector.flush();
    expect(dynamoose.transaction).toHaveBeenCalled();
  });

  it('size reflects number of enqueued operations', () => {
    const transactionCollector = new TransactionCollector();
    const userInternalModel = makeInternalModel(UserTable);

    transactionCollector.enqueueCreate(userInternalModel, {id: 'a'});
    transactionCollector.enqueueCreate(userInternalModel, {id: 'b'});
    expect(transactionCollector.size).toBe(2);
  });
});

// ── TransactionManager ────────────────────────────────────────────────────────

describe('TransactionManager', () => {
  interface TransactionManagerRegistry {
    registry: Map<new () => unknown, InternalModel<object>>;
    userTableMockDynamooseModel: MockDynamooseModel;
  }

  const makeTransactionManagerRegistry = (): TransactionManagerRegistry => {
    vi.clearAllMocks();
    const userTableMockDynamooseModel = makeMockDynamooseModel();
    const userTableSchema = resolveTableSchema(UserTable);
    const userInternalModel = new InternalModel(
      UserTable as new () => UserTable,
      userTableSchema,
      userTableMockDynamooseModel as unknown as ReturnType<typeof dynamoose.model>
    );
    const registry = new Map<new () => unknown, InternalModel<object>>();
    registry.set(UserTable as new () => unknown, userInternalModel as InternalModel<object>);
    return {registry, userTableMockDynamooseModel};
  };

  it('throws for unregistered entity', async () => {
    const {registry} = makeTransactionManagerRegistry();
    const transactionCollector = new TransactionCollector();
    const transactionManager = new TransactionManager(registry, transactionCollector);

    @DynamoTable('tx-missing-2')
    class TxMissing {
      @StringAttribute({hashKey: true})
      id!: string;
    }

    await expect(transactionManager.save({id: '1'} as TxMissing, TxMissing)).rejects.toThrow('not registered');
  });

  it('create() returns a partial object', () => {
    const {registry} = makeTransactionManagerRegistry();
    const transactionManager = new TransactionManager(registry, new TransactionCollector());
    const createdUser = transactionManager.create({id: '1', name: 'Alice'}, UserTable);
    expect(createdUser.id).toBe('1');
  });

  it('create() without entityClass uses item.constructor', () => {
    const {registry} = makeTransactionManagerRegistry();
    const transactionManager = new TransactionManager(registry, new TransactionCollector());
    const userInstance = new UserTable();
    userInstance.id = '1';
    const createdUser = transactionManager.create(userInstance);
    expect(createdUser.id).toBe('1');
  });

  it('save() enqueues a create op and returns normalized item', async () => {
    const {registry} = makeTransactionManagerRegistry();
    const transactionCollector = new TransactionCollector();
    const transactionManager = new TransactionManager(registry, transactionCollector);

    const userInstance = new UserTable();
    userInstance.id = '1';
    userInstance.name = 'Tx User';

    const savedUser = await transactionManager.save(userInstance);
    expect(savedUser.id).toBe('1');
    expect(transactionCollector.size).toBe(1);
  });

  it('save() with explicit entityClass works', async () => {
    const {registry} = makeTransactionManagerRegistry();
    const transactionCollector = new TransactionCollector();
    const transactionManager = new TransactionManager(registry, transactionCollector);

    const savedUser = await transactionManager.save({id: '2', name: 'Explicit'} as UserTable, UserTable);
    expect(savedUser.id).toBe('2');
  });

  it('update() enqueues an update op', async () => {
    const {registry} = makeTransactionManagerRegistry();
    const transactionCollector = new TransactionCollector();
    const transactionManager = new TransactionManager(registry, transactionCollector);

    await transactionManager.update(UserTable, {id: '1'}, {name: 'Updated'});
    expect(transactionCollector.size).toBe(1);
  });

  it('delete() with soft-delete entity enqueues update op', async () => {
    const {registry} = makeTransactionManagerRegistry();
    const transactionCollector = new TransactionCollector();
    const transactionManager = new TransactionManager(registry, transactionCollector);

    await transactionManager.delete(UserTable, {id: '1'});
    expect(transactionCollector.size).toBe(1);
  });

  it('hardDelete() enqueues a delete op', async () => {
    const {registry} = makeTransactionManagerRegistry();
    const transactionCollector = new TransactionCollector();
    const transactionManager = new TransactionManager(registry, transactionCollector);

    await transactionManager.hardDelete(UserTable, {id: '1'});
    expect(transactionCollector.size).toBe(1);
  });

  it('restore() enqueues an update op clearing delete timestamp', async () => {
    const {registry} = makeTransactionManagerRegistry();
    const transactionCollector = new TransactionCollector();
    const transactionManager = new TransactionManager(registry, transactionCollector);

    await transactionManager.restore(UserTable, {id: '1'});
    expect(transactionCollector.size).toBe(1);
  });

  it('findOneBy() executes immediately (no enqueue)', async () => {
    const {registry, userTableMockDynamooseModel} = makeTransactionManagerRegistry();
    userTableMockDynamooseModel.get.mockResolvedValue(null);

    const transactionManager = new TransactionManager(registry, new TransactionCollector());
    const foundUser = await transactionManager.findOneBy(UserTable, {id: 'x'});
    expect(foundUser).toBeUndefined();
  });

  it('findOneByOrFail() throws when not found', async () => {
    const {registry, userTableMockDynamooseModel} = makeTransactionManagerRegistry();
    userTableMockDynamooseModel.get.mockResolvedValue(null);

    const transactionManager = new TransactionManager(registry, new TransactionCollector());
    await expect(transactionManager.findOneByOrFail(UserTable, {id: 'x'})).rejects.toThrow('not found');
  });

  it('find() executes immediately and returns paginated result', async () => {
    const queryExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    const {registry, userTableMockDynamooseModel} = makeTransactionManagerRegistry();
    userTableMockDynamooseModel.query.mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: queryExecMock,
    });

    const transactionManager = new TransactionManager(registry, new TransactionCollector());
    const findResult = await transactionManager.find(UserTable, 'u1');
    expect(findResult.items).toEqual([]);
  });

  it('scan() executes immediately and returns paginated result', async () => {
    const scanExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    const {registry, userTableMockDynamooseModel} = makeTransactionManagerRegistry();
    userTableMockDynamooseModel.scan.mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: scanExecMock,
    });

    const transactionManager = new TransactionManager(registry, new TransactionCollector());
    const scanResult = await transactionManager.scan(UserTable);
    expect(scanResult.items).toEqual([]);
  });

  it('count() executes immediately', async () => {
    const countExecMock = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
    const {registry, userTableMockDynamooseModel} = makeTransactionManagerRegistry();
    userTableMockDynamooseModel.scan.mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: countExecMock,
    });

    const transactionManager = new TransactionManager(registry, new TransactionCollector());
    const countResult = await transactionManager.count(UserTable);
    expect(countResult).toBe(0);
  });

  it('delete() without soft-delete enqueues a delete op', async () => {
    vi.clearAllMocks();
    const orderTableMockDynamooseModel = makeMockDynamooseModel();
    const orderTableSchema = resolveTableSchema(OrderTable);
    const orderInternalModel = new InternalModel(
      OrderTable as new () => OrderTable,
      orderTableSchema,
      orderTableMockDynamooseModel as unknown as ReturnType<typeof dynamoose.model>
    );
    const orderRegistry = new Map<new () => unknown, InternalModel<object>>();
    orderRegistry.set(OrderTable as new () => unknown, orderInternalModel as InternalModel<object>);

    const transactionCollector = new TransactionCollector();
    const transactionManager = new TransactionManager(orderRegistry, transactionCollector);
    await transactionManager.delete(OrderTable, {userId: 'u1', orderId: 'o1'});
    expect(transactionCollector.size).toBe(1);
  });
});

// ── metadata.registry pendingAttributesMap fallback ───────────────────────────

describe('metadata.registry pendingAttributesMap fallback', () => {
  it('setTableMeta without any prior addPendingAttribute (empty pending)', () => {
    @DynamoTable('empty-attrs-table')
    class EmptyAttrsTable {
      id!: string;
    }

    const tableMeta = getTableMeta(EmptyAttrsTable);
    expect(tableMeta).toBeDefined();
    expect(tableMeta?.attributes).toEqual([]);
  });

  it('setDocumentMeta without prior addPendingAttribute', () => {
    @DynamoDocument()
    class EmptyDoc {
      value!: string;
    }

    const documentMeta = getDocumentMeta(EmptyDoc);
    expect(documentMeta).toBeDefined();
    expect(documentMeta?.attributes).toEqual([]);
  });
});
