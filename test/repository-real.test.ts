import {DeleteDateAttribute, DynamoTable, StringAttribute} from '#';
import {DataSource} from '#/data-source/data-source';
import dynamoose from 'dynamoose';
import {afterEach, beforeEach, describe, expect, it, type Mock, vi} from 'vitest';
import {OrderTable, UserTable} from './fixtures';

interface MockModel {
  get: Mock;
  create: Mock;
  update: Mock;
  delete: Mock;
  batchGet: Mock;
  batchPut: Mock;
  batchDelete: Mock;
  query: Mock;
  scan: Mock;
}

// Mock dynamoose
vi.mock('dynamoose', async importOriginal => {
  const actual = await importOriginal();

  const queryChain: Record<string, any> = {};
  const whereChain: Record<string, any> = {};
  for (const m of ['eq', 'lt', 'lte', 'gt', 'gte', 'between', 'beginsWith', 'limit', 'consistent', 'startAt']) {
    whereChain[m] = vi.fn().mockReturnValue(whereChain);
  }
  whereChain.exec = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));

  for (const m of [
    'eq',
    'ne',
    'lt',
    'lte',
    'gt',
    'gte',
    'between',
    'beginsWith',
    'contains',
    'in',
    'exists',
    'limit',
    'consistent',
    'startAt',
    'using',
  ]) {
    queryChain[m] = vi.fn().mockReturnValue(queryChain);
  }
  queryChain.exec = vi.fn();
  queryChain.where = vi.fn().mockReturnValue(whereChain);
  queryChain.filter = vi.fn().mockReturnValue(queryChain);
  queryChain.not = vi.fn().mockReturnValue({
    eq: vi.fn(() => queryChain),
    exists: vi.fn(() => queryChain),
  });

  const scanChain: Record<string, any> = {};
  for (const m of [
    'eq',
    'ne',
    'lt',
    'lte',
    'gt',
    'gte',
    'between',
    'beginsWith',
    'contains',
    'in',
    'exists',
    'limit',
    'startAt',
    'count',
    'using',
  ]) {
    scanChain[m] = vi.fn().mockReturnValue(scanChain);
  }
  scanChain.exec = vi.fn();
  scanChain.filter = vi.fn().mockReturnValue(scanChain);
  scanChain.not = vi.fn().mockReturnValue({
    eq: vi.fn(() => scanChain),
    exists: vi.fn(() => scanChain),
  });

  const mockModel: MockModel = {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchGet: vi.fn(),
    batchPut: vi.fn(),
    batchDelete: vi.fn(),
    query: vi.fn().mockReturnValue(queryChain),
    scan: vi.fn().mockReturnValue(scanChain),
  };

  class MockInstance {
    aws = {ddb: {set: vi.fn(), local: vi.fn()}};
    Table = vi.fn();
  }

  return {
    ...(actual as Record<string, unknown>),
    model: vi.fn().mockReturnValue(mockModel),
    Schema: vi.fn().mockImplementation(definition => ({definition})),
    transaction: vi.fn(),
    Instance: MockInstance,
    default: {
      model: vi.fn().mockReturnValue(mockModel),
      Schema: vi.fn(),
      transaction: vi.fn(),
      Instance: MockInstance,
    },
  };
});

const makeItem = (data: Record<string, unknown>): any => ({...data, toJSON: () => data});

describe('Repository Integration (Real Logic)', () => {
  let dataSource: DataSource;
  let mockModel: MockModel;

  beforeEach(async () => {
    vi.clearAllMocks();
    dataSource = new DataSource({entities: [UserTable]});
    await dataSource.initialize();
    mockModel = vi.mocked(dynamoose.model('', {}));
  });

  describe('findOneBy', () => {
    it('calls dynamoose get with correct keys', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.get.mockResolvedValue(makeItem({id: '1', name: 'Test'}));

      const result = await repo.findOneBy({id: '1'});

      expect(mockModel.get).toHaveBeenCalledWith({id: '1'});
      expect(result).toBeInstanceOf(UserTable);
      expect(result?.name).toBe('Test');
    });

    it('returns undefined if not found', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.get.mockResolvedValue(null as any);

      const result = await repo.findOneBy({id: 'non-existent'});

      expect(result).toBeUndefined();
    });

    it('returns undefined if soft-deleted', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.get.mockResolvedValue(makeItem({id: '1', deleted_at: new Date()}));

      const result = await repo.findOneBy({id: '1'});
      expect(result).toBeUndefined();
    });

    it('returns item if soft-deleted but withDeleted: true', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.get.mockResolvedValue(makeItem({id: '1', deleted_at: new Date()}));

      const result = await repo.findOneBy({id: '1'}, {withDeleted: true});
      expect(result).toBeDefined();
    });
  });

  describe('findOneByOrFail', () => {
    it('throws if item not found', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.get.mockResolvedValue(null as any);
      await expect(repo.findOneByOrFail({id: '1'})).rejects.toThrow('Entity not found');
    });
  });

  describe('save', () => {
    it('calls dynamoose create for new entities', async () => {
      const repo = dataSource.getRepository(UserTable);
      const user = new UserTable();
      user.id = '1';
      user.name = 'New';

      mockModel.create.mockResolvedValue(makeItem({id: '1', name: 'New'}));

      await repo.save(user);

      expect(mockModel.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('calls dynamoose update with changes', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.update.mockResolvedValue(makeItem({id: '1', name: 'Changed'}));

      const result = await repo.update({id: '1'}, {name: 'Changed'});

      expect(mockModel.update).toHaveBeenCalled();
      expect(result.name).toBe('Changed');
    });
  });

  describe('findByIndex', () => {
    it('queries by GSI using attribute alias as index hash key', async () => {
      const repo = dataSource.getRepository(UserTable);
      const queryChain = mockModel.query('is_active');
      queryChain.exec.mockResolvedValue(
        Object.assign([makeItem({id: '1', name: 'Alice', is_active: true})], {lastKey: undefined})
      );

      const result = await repo.findByIndex('isActive', true);

      expect(mockModel.query).toHaveBeenCalledWith('is_active');
      expect(queryChain.using).toHaveBeenCalledWith('is_activeGlobalIndex');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('1');
      expect(result.count).toBe(1);
    });

    it('filters soft-deleted items from GSI results', async () => {
      const repo = dataSource.getRepository(UserTable);
      const queryChain = mockModel.query('is_active');
      queryChain.exec.mockResolvedValue(
        Object.assign(
          [makeItem({id: '1', is_active: true}), makeItem({id: '2', is_active: true, deleted_at: new Date()})],
          {lastKey: undefined}
        )
      );

      const result = await repo.findByIndex('isActive', true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('1');
    });

    it('includes soft-deleted with withDeleted: true', async () => {
      const repo = dataSource.getRepository(UserTable);
      const queryChain = mockModel.query('is_active');
      queryChain.exec.mockResolvedValue(
        Object.assign(
          [makeItem({id: '1', is_active: true}), makeItem({id: '2', is_active: true, deleted_at: new Date()})],
          {lastKey: undefined}
        )
      );

      const result = await repo.findByIndex('isActive', true, {withDeleted: true});
      expect(result.items).toHaveLength(2);
    });

    it('passes limit and startAt to query chain', async () => {
      const repo = dataSource.getRepository(UserTable);
      const queryChain = mockModel.query('is_active');
      queryChain.exec.mockResolvedValue(Object.assign([], {lastKey: {id: '5'}}));

      await repo.findByIndex('isActive', true, {limit: 10, startAt: {id: '0'}});

      expect(queryChain.limit).toHaveBeenCalledWith(10);
      expect(queryChain.startAt).toHaveBeenCalledWith({id: '0'});
    });
  });

  describe('find / query', () => {
    it('executes a query and returns items', async () => {
      const repo = dataSource.getRepository(UserTable);
      const queryChainMock = mockModel.query('id');
      queryChainMock.exec.mockResolvedValue([
        makeItem({id: '1', name: 'A'}),
        makeItem({id: '2', name: 'B', deleted_at: new Date()}),
      ]);

      const result = await repo.find('val');

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('1');
      expect(result.count).toBe(1);
    });
  });

  describe('find with sort key conditions', () => {
    const makeSortKeyMock = () => {
      const whereChain = {
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
      };
      const queryMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnValue(whereChain),
        limit: vi.fn().mockReturnThis(),
        consistent: vi.fn().mockReturnThis(),
        startAt: vi.fn().mockReturnThis(),
        using: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
      });
      return {whereChain, queryMock};
    };

    const makeOrderDs = async (queryMock: Mock) => {
      const orderMock = {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        batchGet: vi.fn(),
        batchPut: vi.fn(),
        batchDelete: vi.fn(),
        query: queryMock,
        scan: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined})),
          limit: vi.fn().mockReturnThis(),
          startAt: vi.fn().mockReturnThis(),
          count: vi.fn().mockReturnThis(),
          using: vi.fn().mockReturnThis(),
        }),
      };
      vi.spyOn(dynamoose, 'model').mockReturnValue(orderMock as any);
      const ds = new DataSource({entities: [OrderTable]});
      await ds.initialize();
      return ds.getRepository(OrderTable);
    };

    afterEach(() => vi.restoreAllMocks());

    it('applies sortKey.eq condition on range key', async () => {
      const {whereChain, queryMock} = makeSortKeyMock();
      const repo = await makeOrderDs(queryMock);
      await repo.find('user-1', {sortKey: {eq: 'order-1'}});
      expect(queryMock().where).toHaveBeenCalledWith('orderId');
      expect(whereChain.eq).toHaveBeenCalledWith('order-1');
    });

    it('applies sortKey.lt condition on range key', async () => {
      const {whereChain, queryMock} = makeSortKeyMock();
      const repo = await makeOrderDs(queryMock);
      await repo.find('user-1', {sortKey: {lt: 'order-5'}});
      expect(whereChain.lt).toHaveBeenCalledWith('order-5');
    });

    it('applies sortKey.lte condition on range key', async () => {
      const {whereChain, queryMock} = makeSortKeyMock();
      const repo = await makeOrderDs(queryMock);
      await repo.find('user-1', {sortKey: {lte: 'order-5'}});
      expect(whereChain.lte).toHaveBeenCalledWith('order-5');
    });

    it('applies sortKey.gt condition on range key', async () => {
      const {whereChain, queryMock} = makeSortKeyMock();
      const repo = await makeOrderDs(queryMock);
      await repo.find('user-1', {sortKey: {gt: 'order-1'}});
      expect(whereChain.gt).toHaveBeenCalledWith('order-1');
    });

    it('applies sortKey.gte condition on range key', async () => {
      const {whereChain, queryMock} = makeSortKeyMock();
      const repo = await makeOrderDs(queryMock);
      await repo.find('user-1', {sortKey: {gte: 'order-1'}});
      expect(whereChain.gte).toHaveBeenCalledWith('order-1');
    });

    it('applies sortKey.between condition on range key', async () => {
      const {whereChain, queryMock} = makeSortKeyMock();
      const repo = await makeOrderDs(queryMock);
      await repo.find('user-1', {sortKey: {between: ['order-1', 'order-9']}});
      expect(whereChain.between).toHaveBeenCalledWith('order-1', 'order-9');
    });

    it('applies sortKey.beginsWith condition on range key', async () => {
      const {whereChain, queryMock} = makeSortKeyMock();
      const repo = await makeOrderDs(queryMock);
      await repo.find('user-1', {sortKey: {beginsWith: 'order-2024'}});
      expect(whereChain.beginsWith).toHaveBeenCalledWith('order-2024');
    });

    it('skips sortKey when table has no rangeKey', async () => {
      const repo = dataSource.getRepository(UserTable);
      const queryChain = mockModel.query('id');
      queryChain.exec.mockResolvedValue(Object.assign([], {lastKey: undefined}));
      await repo.find('val', {sortKey: {eq: 'ignored'}});
      expect(queryChain.where).not.toHaveBeenCalled();
    });
  });

  describe('scan', () => {
    it('executes a scan and returns items', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.scan().exec.mockResolvedValue([makeItem({id: '1'})]);

      const result = await repo.scan();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('1');
    });
  });

  describe('count', () => {
    it('returns total count filtered by soft-delete (scan path)', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.scan().exec.mockResolvedValue([makeItem({id: '1'}), makeItem({id: '2'})]);

      const result = await repo.count();
      expect(result).toBe(2);
    });

    it('count({withDeleted: true}) uses Select: COUNT — no item bodies', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.scan().exec.mockResolvedValue({count: 7, scannedCount: 7});

      const result = await repo.count({withDeleted: true});
      expect(result).toBe(7);
    });
  });

  describe('batch operations', () => {
    afterEach(() => vi.restoreAllMocks());

    it('batchSave calls batchPut', async () => {
      const repo = dataSource.getRepository(UserTable);
      await repo.batchSave([new UserTable()]);
      expect(mockModel.batchPut).toHaveBeenCalled();
    });

    it('batchSave runs beforeInsert and afterInsert hooks for each item', async () => {
      const beforeInsert = vi.fn();
      const afterInsert = vi.fn();

      @DynamoTable('batch-hooked', {hooks: {beforeInsert, afterInsert}})
      class BatchHookedTable {
        @StringAttribute({hashKey: true})
        id!: string;
      }

      const hookMock: MockModel = {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        batchGet: vi.fn(),
        batchPut: vi.fn(),
        batchDelete: vi.fn(),
        query: vi.fn().mockReturnValue({eq: vi.fn().mockReturnThis(), exec: vi.fn()}),
        scan: vi.fn().mockReturnValue({exec: vi.fn()}),
      };
      vi.spyOn(dynamoose, 'model').mockReturnValue(hookMock as any);
      const ds = new DataSource({entities: [BatchHookedTable]});
      await ds.initialize();

      const repo = ds.getRepository(BatchHookedTable);
      await repo.batchSave([{id: 'a'} as BatchHookedTable, {id: 'b'} as BatchHookedTable]);

      expect(hookMock.batchPut).toHaveBeenCalled();
      expect(beforeInsert).toHaveBeenCalledTimes(2);
      expect(afterInsert).toHaveBeenCalledTimes(2);
    });

    it('batchDelete calls batchDelete', async () => {
      const repo = dataSource.getRepository(UserTable);
      await repo.batchDelete([{id: '1'}]);
      expect(mockModel.batchDelete).toHaveBeenCalled();
    });

    it('batchGet matches items by hashKey', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.batchGet.mockResolvedValue([{id: '1', name: 'Item 1'}]);

      const results = await repo.batchGet([{id: '1'}, {id: '2'}]);
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeUndefined();
    });
  });

  describe('restore', () => {
    it('clears delete date', async () => {
      const repo = dataSource.getRepository(UserTable);
      await repo.restore({id: '1'});
      expect(mockModel.update).toHaveBeenCalledWith({id: '1'}, {deleted_at: null});
    });
  });

  describe('filter expressions', () => {
    const makeFilterMock = () => {
      const qc: Record<string, any> = [
        'eq',
        'ne',
        'lt',
        'lte',
        'gt',
        'gte',
        'between',
        'beginsWith',
        'contains',
        'in',
        'exists',
        'limit',
        'consistent',
        'startAt',
        'using',
      ].reduce(
        (acc, m) => {
          acc[m] = vi.fn().mockReturnValue(acc);
          return acc;
        },
        {} as Record<string, any>
      );
      qc.exec = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
      qc.filter = vi.fn().mockReturnValue(qc);
      qc.not = vi.fn().mockReturnValue({eq: vi.fn(() => qc), exists: vi.fn(() => qc)});
      return qc;
    };

    const makeScanMock = () => {
      const sc: Record<string, any> = [
        'eq',
        'ne',
        'lt',
        'lte',
        'gt',
        'gte',
        'between',
        'beginsWith',
        'contains',
        'in',
        'exists',
        'limit',
        'startAt',
        'count',
        'using',
      ].reduce(
        (acc, m) => {
          acc[m] = vi.fn().mockReturnValue(acc);
          return acc;
        },
        {} as Record<string, any>
      );
      sc.exec = vi.fn().mockResolvedValue(Object.assign([], {lastKey: undefined}));
      sc.filter = vi.fn().mockReturnValue(sc);
      sc.not = vi.fn().mockReturnValue({eq: vi.fn(() => sc), exists: vi.fn(() => sc)});
      return sc;
    };

    const makeDs = async (qc: Record<string, any>, sc?: Record<string, any>) => {
      const m = {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        batchGet: vi.fn(),
        batchPut: vi.fn(),
        batchDelete: vi.fn(),
        query: vi.fn().mockReturnValue(qc),
        scan: vi.fn().mockReturnValue(sc ?? makeScanMock()),
      };
      vi.spyOn(dynamoose, 'model').mockReturnValue(m as any);
      const ds = new DataSource({entities: [UserTable]});
      await ds.initialize();
      return {repo: ds.getRepository(UserTable), m};
    };

    afterEach(() => vi.restoreAllMocks());

    it('find: eq filter calls filter(attr).eq(val)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {name: {eq: 'Alice'}}});
      expect(qc.filter).toHaveBeenCalledWith('name');
      expect(qc.eq).toHaveBeenCalledWith('Alice');
    });

    it('find: ne filter calls filter(attr).ne(val)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {name: {ne: 'Bob'}}});
      expect(qc.filter).toHaveBeenCalledWith('name');
      expect(qc.ne).toHaveBeenCalledWith('Bob');
    });

    it('find: lt filter calls filter(attr).lt(val)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {age: {lt: 30}}});
      expect(qc.filter).toHaveBeenCalledWith('age');
      expect(qc.lt).toHaveBeenCalledWith(30);
    });

    it('find: lte filter calls filter(attr).lte(val)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {age: {lte: 30}}});
      expect(qc.filter).toHaveBeenCalledWith('age');
      expect(qc.lte).toHaveBeenCalledWith(30);
    });

    it('find: gt filter calls filter(attr).gt(val)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {age: {gt: 18}}});
      expect(qc.filter).toHaveBeenCalledWith('age');
      expect(qc.gt).toHaveBeenCalledWith(18);
    });

    it('find: gte filter calls filter(attr).gte(val)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {age: {gte: 18}}});
      expect(qc.filter).toHaveBeenCalledWith('age');
      expect(qc.gte).toHaveBeenCalledWith(18);
    });

    it('find: between filter calls filter(attr).between(a, b)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {age: {between: [18, 65]}}});
      expect(qc.filter).toHaveBeenCalledWith('age');
      expect(qc.between).toHaveBeenCalledWith(18, 65);
    });

    it('find: beginsWith filter calls filter(attr).beginsWith(val)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {name: {beginsWith: 'Al'}}});
      expect(qc.filter).toHaveBeenCalledWith('name');
      expect(qc.beginsWith).toHaveBeenCalledWith('Al');
    });

    it('find: contains filter calls filter(attr).contains(val)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {name: {contains: 'lic'}}});
      expect(qc.filter).toHaveBeenCalledWith('name');
      expect(qc.contains).toHaveBeenCalledWith('lic');
    });

    it('find: exists:true filter calls filter(attr).exists()', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {name: {exists: true}}});
      expect(qc.filter).toHaveBeenCalledWith('name');
      expect(qc.exists).toHaveBeenCalled();
    });

    it('find: exists:false filter calls filter(attr).not().exists()', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {name: {exists: false}}});
      expect(qc.filter).toHaveBeenCalledWith('name');
      expect(qc.not).toHaveBeenCalled();
      const notChain = (qc.not as Mock).mock.results[0]!.value;
      expect(notChain.exists).toHaveBeenCalled();
    });

    it('find: in filter calls filter(attr).in(vals)', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {name: {in: ['Alice', 'Bob']}}});
      expect(qc.filter).toHaveBeenCalledWith('name');
      expect(qc.in).toHaveBeenCalledWith(['Alice', 'Bob']);
    });

    it('find: resolves aliased property key to attribute name', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.find('h', {filter: {isActive: {eq: true}}});
      expect(qc.filter).toHaveBeenCalledWith('is_active');
      expect(qc.eq).toHaveBeenCalledWith(true);
    });

    it('scan: eq filter calls filter(attr).eq(val)', async () => {
      const qc = makeFilterMock();
      const sc = makeScanMock();
      const {repo} = await makeDs(qc, sc);
      await repo.scan({filter: {name: {eq: 'Alice'}}});
      expect(sc.filter).toHaveBeenCalledWith('name');
      expect(sc.eq).toHaveBeenCalledWith('Alice');
    });

    it('scan: exists:false filter calls filter(attr).not().exists()', async () => {
      const qc = makeFilterMock();
      const sc = makeScanMock();
      const {repo} = await makeDs(qc, sc);
      await repo.scan({filter: {name: {exists: false}}});
      expect(sc.filter).toHaveBeenCalledWith('name');
      expect(sc.not).toHaveBeenCalled();
      const notChain = (sc.not as Mock).mock.results[0]!.value;
      expect(notChain.exists).toHaveBeenCalled();
    });

    it('findByIndex: filter applied alongside GSI query', async () => {
      const qc = makeFilterMock();
      const {repo} = await makeDs(qc);
      await repo.findByIndex('isActive', true, {filter: {name: {eq: 'Alice'}}});
      expect(qc.filter).toHaveBeenCalledWith('name');
      expect(qc.eq).toHaveBeenCalledWith('Alice');
    });
  });

  describe('count with GSI optimization', () => {
    it('uses sparse GSI arithmetic when deleteDateIndexName is set', async () => {
      @DynamoTable('gsi-count-table')
      class GsiCountTable {
        @StringAttribute({hashKey: true})
        id!: string;
        @DeleteDateAttribute('deleted_at', {index: true})
        deletedAt!: Date | null;
      }

      const totalExec = vi.fn().mockResolvedValue({count: 10, scannedCount: 10});
      const gsiExec = vi.fn().mockResolvedValue({count: 3, scannedCount: 3});
      const gsiCountChain = {count: vi.fn().mockReturnThis(), exec: gsiExec};
      const totalCountChain = {count: vi.fn().mockReturnThis(), exec: totalExec};

      const gsiMock: MockModel = {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        batchGet: vi.fn(),
        batchPut: vi.fn(),
        batchDelete: vi.fn(),
        query: vi.fn().mockReturnValue({eq: vi.fn().mockReturnThis(), exec: vi.fn()}),
        scan: vi
          .fn()
          .mockReturnValueOnce(totalCountChain)
          .mockReturnValueOnce({using: vi.fn().mockReturnValue(gsiCountChain)}),
      };
      vi.spyOn(dynamoose, 'model').mockReturnValue(gsiMock as any);

      const ds = new DataSource({entities: [GsiCountTable]});
      await ds.initialize();
      const repo = ds.getRepository(GsiCountTable);

      const result = await repo.count();
      expect(result).toBe(7);
      expect(totalExec).toHaveBeenCalled();
      expect(gsiExec).toHaveBeenCalled();
    });
  });
});
