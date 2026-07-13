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
      onEvent: (e: {eventName: string; image: Record<string, unknown>}) => Promise<void>;
    };
    await listener.onEvent({eventName: 'MODIFY', image: {id: 'u1', name: 'Alice'}});

    expect(callback).toHaveBeenCalledTimes(1);
    const received = callback.mock.calls[0]![0] as UserTable;
    expect(received.id).toBe('u1');
    expect(received.name).toBe('Alice');
    expect(received).toBeInstanceOf(UserTable);
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
});
