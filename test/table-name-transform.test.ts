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

describe('InMemoryDataSource table prefix/suffix', () => {
  it('applies prefix to table name', () => {
    const ds = new InMemoryDataSource({
      entities: [UserTable],
      table: {prefix: 'prod_'},
    });
    expect(ds.getRepository(UserTable).tableName).toBe('prod_users');
  });

  it('applies suffix to table name', () => {
    const ds = new InMemoryDataSource({
      entities: [UserTable],
      table: {suffix: '_v2'},
    });
    expect(ds.getRepository(UserTable).tableName).toBe('users_v2');
  });

  it('applies both prefix and suffix to table name', () => {
    const ds = new InMemoryDataSource({
      entities: [UserTable],
      table: {prefix: 'prod_', suffix: '_v2'},
    });
    expect(ds.getRepository(UserTable).tableName).toBe('prod_users_v2');
  });

  it('preserves base name when table option is omitted (backward compat)', () => {
    const ds = new InMemoryDataSource({entities: [UserTable]});
    expect(ds.getRepository(UserTable).tableName).toBe('users');
  });

  it('preserves base name when prefix and suffix are empty strings', () => {
    const ds = new InMemoryDataSource({
      entities: [UserTable],
      table: {prefix: '', suffix: ''},
    });
    expect(ds.getRepository(UserTable).tableName).toBe('users');
  });
});

describe('InMemoryDataSource.ping', () => {
  it('returns true when pinged', async () => {
    const ds = new InMemoryDataSource({entities: [UserTable]});
    const pingResult = await ds.ping();
    expect(pingResult).toBe(true);
  });
});
