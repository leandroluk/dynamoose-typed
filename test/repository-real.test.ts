import {DataSource} from '#/data-source/data-source';
import dynamoose from 'dynamoose';
import {beforeEach, describe, expect, it, type Mock, vi} from 'vitest';
import {UserTable} from './fixtures';

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

  const mockModel: MockModel = {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchGet: vi.fn(),
    batchPut: vi.fn(),
    batchDelete: vi.fn(),
    query: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      consistent: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: vi.fn(),
    }),
    scan: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      startAt: vi.fn().mockReturnThis(),
      exec: vi.fn(),
    }),
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
    it('returns total count', async () => {
      const repo = dataSource.getRepository(UserTable);
      mockModel.scan().exec.mockResolvedValue([makeItem({id: '1'}), makeItem({id: '2'})]);

      const result = await repo.count();
      expect(result).toBe(2);
    });
  });

  describe('batch operations', () => {
    it('batchSave calls batchPut', async () => {
      const repo = dataSource.getRepository(UserTable);
      await repo.batchSave([new UserTable()]);
      expect(mockModel.batchPut).toHaveBeenCalled();
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
});
