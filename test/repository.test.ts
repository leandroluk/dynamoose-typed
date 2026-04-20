import {InMemoryDataSource} from '#/testing/in-memory-data-source';
import {beforeEach, describe, expect, it} from 'vitest';
import {OrderTable, UserTable} from './fixtures';

// ─── Setup ────────────────────────────────────────────────────────────────────

let ds: InMemoryDataSource;

const alice = (): UserTable => ({
  id: 'u1',
  name: 'Alice',
  age: 30,
  isActive: true,
  hobbies: ['reading'],
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

const bob = (): UserTable => ({
  id: 'u2',
  name: 'Bob',
  age: 25,
  isActive: false,
  hobbies: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

beforeEach(() => {
  ds = new InMemoryDataSource({entities: [UserTable, OrderTable]});
});

// ─── save / findOneBy ─────────────────────────────────────────────────────────

describe('save & findOneBy', () => {
  it('persists an item and retrieves it by key', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    const found = await repo.findOneBy({id: 'u1'});
    expect(found?.name).toBe('Alice');
  });

  it('returns undefined for missing key', async () => {
    const repo = ds.getRepository(UserTable);
    const found = await repo.findOneBy({id: 'nope'});
    expect(found).toBeUndefined();
  });

  it('findOneByOrFail throws for missing item', async () => {
    const repo = ds.getRepository(UserTable);
    await expect(repo.findOneByOrFail({id: 'nope'})).rejects.toThrow('not found');
  });
});

// ─── update ───────────────────────────────────────────────────────────────────

describe('update', () => {
  it('applies partial changes to existing item', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    const updated = await repo.update({id: 'u1'}, {name: 'Alicia', age: 31});
    expect(updated.name).toBe('Alicia');
    expect(updated.age).toBe(31);
  });

  it('throws when updating non-existent item', async () => {
    const repo = ds.getRepository(UserTable);
    await expect(repo.update({id: 'ghost'}, {name: 'X'})).rejects.toThrow('not found');
  });
});

// ─── soft delete ──────────────────────────────────────────────────────────────

describe('soft delete', () => {
  it('delete() sets deletedAt and hides from findOneBy by default', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    await repo.delete({id: 'u1'});

    const hidden = await repo.findOneBy({id: 'u1'});
    expect(hidden).toBeUndefined();

    const visible = await repo.findOneBy({id: 'u1'}, {withDeleted: true});
    expect(visible?.deletedAt).toBeInstanceOf(Date);
  });

  it('restore() clears deletedAt', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    await repo.delete({id: 'u1'});
    await repo.restore({id: 'u1'});

    const restored = await repo.findOneBy({id: 'u1'});
    expect(restored).toBeDefined();
    expect(restored?.deletedAt).toBeNull();
  });

  it('hardDelete() removes the item completely', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    await repo.hardDelete({id: 'u1'});

    const gone = await repo.findOneBy({id: 'u1'}, {withDeleted: true});
    expect(gone).toBeUndefined();
  });
});

// ─── scan / count ─────────────────────────────────────────────────────────────

describe('scan & count', () => {
  it('scan returns all non-deleted items by default', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    await repo.save(bob());
    await repo.delete({id: 'u2'});

    const {items, count} = await repo.scan();
    expect(count).toBe(1);
    expect(items[0]!.id).toBe('u1');
  });

  it('scan with withDeleted returns everything', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    await repo.save(bob());
    await repo.delete({id: 'u2'});

    const {count} = await repo.scan({withDeleted: true});
    expect(count).toBe(2);
  });

  it('count respects withDeleted', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    await repo.save(bob());
    await repo.delete({id: 'u1'});

    expect(await repo.count()).toBe(1);
    expect(await repo.count({withDeleted: true})).toBe(2);
  });

  it('scan respects limit', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    await repo.save(bob());

    const {items} = await repo.scan({limit: 1});
    expect(items).toHaveLength(1);
  });
});

// ─── batch ────────────────────────────────────────────────────────────────────

describe('batch operations', () => {
  it('batchSave persists multiple items', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.batchSave([alice(), bob()]);
    expect(await repo.count()).toBe(2);
  });

  it('batchGet returns items in order, undefined for missing', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    const results = await repo.batchGet([{id: 'u1'}, {id: 'missing'}]);
    expect(results[0]?.name).toBe('Alice');
    expect(results[1]).toBeUndefined();
  });

  it('batchDelete removes items', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.batchSave([alice(), bob()]);
    await repo.batchDelete([{id: 'u1'}, {id: 'u2'}]);
    expect(await repo.count()).toBe(0);
  });
});

// ─── manager ─────────────────────────────────────────────────────────────────

describe('manager', () => {
  it('manager.findOneBy works cross-entity style', async () => {
    await ds.getRepository(UserTable).save(alice());
    const found = await ds.manager.findOneBy(UserTable, {id: 'u1'});
    expect(found?.name).toBe('Alice');
  });

  it('manager.save infers entity from class', async () => {
    const user = alice();
    await ds.manager.save(user, UserTable);
    const found = await ds.manager.findOneBy(UserTable, {id: 'u1'});
    expect(found).toBeDefined();
  });

  it('manager.delete soft-deletes', async () => {
    await ds.getRepository(UserTable).save(alice());
    await ds.manager.delete(UserTable, {id: 'u1'});
    const gone = await ds.manager.findOneBy(UserTable, {id: 'u1'});
    expect(gone).toBeUndefined();
  });

  it('manager.count works with withDeleted', async () => {
    await ds.getRepository(UserTable).save(alice());
    await ds.manager.delete(UserTable, {id: 'u1'});
    expect(await ds.manager.count(UserTable)).toBe(0);
    expect(await ds.manager.count(UserTable, {withDeleted: true})).toBe(1);
  });
});

// ─── transaction ──────────────────────────────────────────────────────────────

describe('transaction', () => {
  it('commits all writes when callback succeeds', async () => {
    await ds.transaction(async tx => {
      await tx.save(alice(), UserTable);
      await tx.save(bob(), UserTable);
    });

    expect(await ds.getRepository(UserTable).count()).toBe(2);
  });

  it('reads inside transaction see pre-transaction state', async () => {
    await ds.getRepository(UserTable).save(alice());

    await ds.transaction(async tx => {
      const user = await tx.findOneBy(UserTable, {id: 'u1'});
      expect(user?.name).toBe('Alice');
      await tx.save({...user!, name: 'Updated'}, UserTable);
    });

    const updated = await ds.getRepository(UserTable).findOneBy({id: 'u1'});
    expect(updated?.name).toBe('Updated');
  });

  it('soft-deletes inside transaction work', async () => {
    await ds.getRepository(UserTable).save(alice());
    await ds.transaction(async tx => {
      await tx.delete(UserTable, {id: 'u1'});
    });
    const gone = await ds.getRepository(UserTable).findOneBy({id: 'u1'});
    expect(gone).toBeUndefined();
  });
});

// ─── composite key ────────────────────────────────────────────────────────────

describe('composite key (hash + range)', () => {
  it('stores and retrieves by composite key', async () => {
    const repo = ds.getRepository(OrderTable);
    await repo.save({userId: 'u1', orderId: 'o1', product: 'Book', quantity: 2});
    const found = await repo.findOneBy({userId: 'u1', orderId: 'o1'});
    expect(found?.product).toBe('Book');
  });

  it('different rangeKey → different item', async () => {
    const repo = ds.getRepository(OrderTable);
    await repo.save({userId: 'u1', orderId: 'o1', product: 'Book', quantity: 1});
    await repo.save({userId: 'u1', orderId: 'o2', product: 'Pen', quantity: 3});
    expect(await repo.count()).toBe(2);
  });

  it('find() returns all items for a hashKey', async () => {
    const repo = ds.getRepository(OrderTable);
    await repo.save({userId: 'u1', orderId: 'o1', product: 'Book', quantity: 1});
    await repo.save({userId: 'u1', orderId: 'o2', product: 'Pen', quantity: 3});
    await repo.save({userId: 'u2', orderId: 'o3', product: 'Desk', quantity: 1});

    const {items} = await repo.find('u1');
    expect(items).toHaveLength(2);
    expect(items.every(i => i.userId === 'u1')).toBe(true);
  });
});
