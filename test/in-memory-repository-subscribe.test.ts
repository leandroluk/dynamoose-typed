import {InMemoryDataSource} from '#/testing/in-memory-data-source';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {UserTable} from './fixtures';

let ds: InMemoryDataSource;

const alice = (): UserTable => ({
  id: 'u1',
  name: 'Alice',
  age: 30,
  isActive: true,
  hobbies: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

beforeEach(() => {
  ds = new InMemoryDataSource({entities: [UserTable]});
});

describe('InMemoryRepository.subscribe', () => {
  it('emits INSERT on save() for a new key, MODIFY on save() for an existing key', async () => {
    const repo = ds.getRepository(UserTable);
    const events: {type: string; item: UserTable}[] = [];
    repo.subscribe({
      eventTypes: ['INSERT', 'MODIFY'],
      callback: item => {
        events.push({type: events.length === 0 ? 'INSERT' : 'MODIFY', item});
      },
    });

    await repo.save(alice());
    await repo.save({...alice(), name: 'Alice 2'});

    expect(events).toHaveLength(2);
    expect(events[0]!.item.name).toBe('Alice');
    expect(events[1]!.item.name).toBe('Alice 2');
  });

  it('emits MODIFY on update() and on soft delete()', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());

    const received: string[] = [];
    repo.subscribe({eventTypes: ['MODIFY'], callback: item => void received.push(item.name)});

    await repo.update({id: 'u1'}, {name: 'Updated'});
    await repo.delete({id: 'u1'});

    expect(received).toEqual(['Updated', 'Updated']);
  });

  it('emits REMOVE on hardDelete() with the pre-delete item, and nothing for a missing key', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());

    const removed: UserTable[] = [];
    repo.subscribe({eventTypes: ['REMOVE'], callback: item => void removed.push(item)});

    await repo.hardDelete({id: 'u1'});
    await repo.hardDelete({id: 'ghost'});

    expect(removed).toHaveLength(1);
    expect(removed[0]!.name).toBe('Alice');
  });

  it('emits MODIFY on restore()', async () => {
    const repo = ds.getRepository(UserTable);
    await repo.save(alice());
    await repo.delete({id: 'u1'});

    const received: (Date | null)[] = [];
    repo.subscribe({eventTypes: ['MODIFY'], callback: item => void received.push(item.deletedAt)});

    await repo.restore({id: 'u1'});

    expect(received).toEqual([null]);
  });

  it('emits one event per item for batchSave() and batchDelete()', async () => {
    const repo = ds.getRepository(UserTable);
    const inserts: string[] = [];
    const removes: string[] = [];
    repo.subscribe({eventTypes: ['INSERT'], callback: item => void inserts.push(item.id)});
    repo.subscribe({eventTypes: ['REMOVE'], callback: item => void removes.push(item.id)});

    await repo.batchSave([alice(), {...alice(), id: 'u2', name: 'Bob'}]);
    await repo.batchDelete([{id: 'u1'}, {id: 'u2'}]);

    expect(inserts).toEqual(['u1', 'u2']);
    expect(removes).toEqual(['u1', 'u2']);
  });

  it('filters by eventTypes and stops delivering after close()', async () => {
    const repo = ds.getRepository(UserTable);
    const modifyOnly = vi.fn();
    const subscription = repo.subscribe({eventTypes: ['MODIFY'], callback: modifyOnly});

    await repo.save(alice()); // INSERT — not delivered
    expect(modifyOnly).not.toHaveBeenCalled();

    await repo.save({...alice(), name: 'Alice 2'}); // MODIFY — delivered
    expect(modifyOnly).toHaveBeenCalledTimes(1);

    await subscription.close();
    await repo.save({...alice(), name: 'Alice 3'}); // MODIFY — no longer delivered
    expect(modifyOnly).toHaveBeenCalledTimes(1);
  });
});
