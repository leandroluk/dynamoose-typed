import {InMemoryDataSource} from '#/testing/in-memory-data-source';
import {describe, expect, it} from 'vitest';
import {UserTable} from './fixtures';

describe('InMemoryRepository.tableName', () => {
  it('exposes the base table name from schema', () => {
    const ds = new InMemoryDataSource({entities: [UserTable]});
    const repo = ds.getRepository(UserTable);
    expect(repo.tableName).toBe('users');
  });
});
