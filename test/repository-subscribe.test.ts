import {InternalModel} from '#/model/internal-model';
import {Repository} from '#/repository/repository';
import {resolveTableSchema, type ResolvedSchema} from '#/schema';
import {describe, expect, it, vi} from 'vitest';
import {UserTable} from './fixtures';

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function makeRepo(schemaOverrides: Partial<ResolvedSchema> = {}): {
  repo: Repository<UserTable>;
  model: InternalModel<UserTable>;
} {
  const schema = {...resolveTableSchema(UserTable), ...schemaOverrides};
  const model = new InternalModel(UserTable, schema, {} as never);
  return {repo: new Repository(model), model};
}

describe('Repository.subscribe', () => {
  it('throws synchronously when the entity has no stream configured', () => {
    const {repo} = makeRepo({streamViewType: undefined});
    expect(() => repo.subscribe({eventTypes: ['MODIFY'], callback: vi.fn()})).toThrow(/no stream configured/);
  });

  it('normalizes the event image and invokes the callback', async () => {
    const {repo, model} = makeRepo({streamViewType: 'NEW_AND_OLD_IMAGES'});
    const fakePoller = {
      addListener: vi.fn().mockReturnValue(vi.fn()),
      listenerCount: 0,
    };
    vi.spyOn(model, 'getStreamPoller').mockResolvedValue(fakePoller as never);

    const callback = vi.fn();
    repo.subscribe({eventTypes: ['MODIFY'], callback});
    await flush();

    expect(fakePoller.addListener).toHaveBeenCalledWith(expect.objectContaining({eventTypes: ['MODIFY']}));
    const listener = fakePoller.addListener.mock.calls[0]![0] as {
      onEvent: (e: {
        eventId: string;
        eventName: string;
        image: Record<string, unknown>;
        oldImage?: Record<string, unknown>;
        approximateCreationDateTime?: Date;
        sequenceNumber?: string;
      }) => Promise<void>;
    };
    const creationDate = new Date('2026-01-01T00:00:00Z');
    await listener.onEvent({
      eventId: 'evt-1',
      eventName: 'MODIFY',
      image: {id: 'u1', name: 'Alice', status: 'overdue'},
      oldImage: {id: 'u1', name: 'Alice', status: 'active'},
      approximateCreationDateTime: creationDate,
      sequenceNumber: 'seq-1',
    });

    expect(callback).toHaveBeenCalledTimes(1);
    const received = callback.mock.calls[0]![0] as UserTable;
    expect(received.id).toBe('u1');
    expect(received.name).toBe('Alice');
    expect(received).toBeInstanceOf(UserTable);
    expect(callback.mock.calls[0]![1]).toEqual({
      eventId: 'evt-1',
      eventName: 'MODIFY',
      approximateCreationDateTime: creationDate,
      sequenceNumber: 'seq-1',
      oldItem: {id: 'u1', name: 'Alice', status: 'active'},
    });
  });

  it('routes bootstrap failures to the default onError (console.error)', async () => {
    const {repo, model} = makeRepo({streamViewType: 'NEW_AND_OLD_IMAGES'});
    vi.spyOn(model, 'getStreamPoller').mockRejectedValue(new Error('bootstrap failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    repo.subscribe({eventTypes: ['INSERT'], callback: vi.fn()});
    await flush();

    expect(consoleError).toHaveBeenCalledWith(
      '[dynamoose-typed] stream error:',
      expect.objectContaining({message: 'bootstrap failed'})
    );
    consoleError.mockRestore();
  });

  it('routes bootstrap failures to a custom onError when provided', async () => {
    const {repo, model} = makeRepo({streamViewType: 'NEW_AND_OLD_IMAGES'});
    vi.spyOn(model, 'getStreamPoller').mockRejectedValue(new Error('bootstrap failed'));
    const onError = vi.fn();

    repo.subscribe({eventTypes: ['INSERT'], callback: vi.fn(), options: {onError}});
    await flush();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'bootstrap failed'}));
  });

  it('close() before bootstrap resolves prevents the listener from ever attaching', async () => {
    const {repo, model} = makeRepo({streamViewType: 'NEW_AND_OLD_IMAGES'});
    const fakePoller = {addListener: vi.fn().mockReturnValue(vi.fn()), listenerCount: 0};
    vi.spyOn(model, 'getStreamPoller').mockResolvedValue(fakePoller as never);

    const subscription = repo.subscribe({eventTypes: ['INSERT'], callback: vi.fn()});
    await subscription.close();
    await flush();

    expect(fakePoller.addListener).not.toHaveBeenCalled();
  });

  it('close() after attaching calls the poller-returned unsubscribe function', async () => {
    const {repo, model} = makeRepo({streamViewType: 'NEW_AND_OLD_IMAGES'});
    const unsubscribe = vi.fn();
    const fakePoller = {addListener: vi.fn().mockReturnValue(unsubscribe), listenerCount: 0};
    vi.spyOn(model, 'getStreamPoller').mockResolvedValue(fakePoller as never);

    const subscription = repo.subscribe({eventTypes: ['INSERT'], callback: vi.fn()});
    await flush();
    await subscription.close();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('retries bootstrap when retry option is provided and getStreamPoller fails with ResourceNotFoundException', async () => {
    const {repo, model} = makeRepo({streamViewType: 'NEW_AND_OLD_IMAGES'});
    const fakePoller = {addListener: vi.fn().mockReturnValue(vi.fn()), listenerCount: 0};

    const getStreamPoller = vi
      .spyOn(model, 'getStreamPoller')
      .mockRejectedValueOnce(
        Object.assign(new Error('table not found'), {name: 'ResourceNotFoundException'})
      )
      .mockResolvedValue(fakePoller as never);

    const callback = vi.fn();
    repo.subscribe({
      eventTypes: ['INSERT'],
      callback,
      options: {
        retry: {maxRetries: 3, baseDelayMs: 5, maxDelayMs: 20},
      },
    });

    // Small delay to allow the retry loop to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(getStreamPoller).toHaveBeenCalledTimes(2);
    expect(fakePoller.addListener).toHaveBeenCalledTimes(1);
  });

  it('retry exhausts maxRetries and routes the final error to onError', async () => {
    const {repo, model} = makeRepo({streamViewType: 'NEW_AND_OLD_IMAGES'});

    const getStreamPoller = vi
      .spyOn(model, 'getStreamPoller')
      .mockRejectedValue(
        Object.assign(new Error('table never ready'), {name: 'ResourceNotFoundException'})
      );

    const onError = vi.fn();
    repo.subscribe({
      eventTypes: ['INSERT'],
      callback: vi.fn(),
      options: {
        retry: {maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20},
        onError,
      },
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    // initial + 2 retries = 3 calls
    expect(getStreamPoller).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({message: 'table never ready'})
    );
  });

  it('does not retry when retry option is not provided (normal error routing)', async () => {
    const {repo, model} = makeRepo({streamViewType: 'NEW_AND_OLD_IMAGES'});

    const getStreamPoller = vi
      .spyOn(model, 'getStreamPoller')
      .mockRejectedValue(
        Object.assign(new Error('table not found'), {name: 'ResourceNotFoundException'})
      );

    const onError = vi.fn();
    repo.subscribe({
      eventTypes: ['INSERT'],
      callback: vi.fn(),
      options: {onError},
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(getStreamPoller).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({message: 'table not found'})
    );
  });

  it('sets oldItem to undefined when stream record has no OldImage (NEW_IMAGE view type)', async () => {
    const {repo, model} = makeRepo({streamViewType: 'NEW_IMAGE'});
    const fakePoller = {addListener: vi.fn().mockReturnValue(vi.fn()), listenerCount: 0};
    vi.spyOn(model, 'getStreamPoller').mockResolvedValue(fakePoller as never);

    const callback = vi.fn();
    repo.subscribe({eventTypes: ['MODIFY'], callback});
    await flush();

    const listener = fakePoller.addListener.mock.calls[0]![0] as {
      onEvent: (e: {
        eventId: string;
        eventName: string;
        image: Record<string, unknown>;
        oldImage?: Record<string, unknown>;
      }) => Promise<void>;
    };
    await listener.onEvent({
      eventId: 'evt-1',
      eventName: 'MODIFY',
      image: {id: 'u1', status: 'overdue'},
      // no oldImage — simulating NEW_IMAGE view type
    });

    expect(callback).toHaveBeenCalledTimes(1);
    const [, meta] = callback.mock.calls[0]!;
    expect(meta.oldItem).toBeUndefined();
  });
});
