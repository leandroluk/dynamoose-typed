import type {ResolvedSchema} from '#/schema';
import type {
  CountOptions,
  FindOptions,
  PaginatedResult,
  Projected,
  SelectMap,
  StreamEventType,
  SubscribeParams,
  Subscription,
  WriteOptions,
} from '#/types';

function projectItem<T>(item: T, select: SelectMap<T> | undefined): unknown {
  if (!select) {
    return item;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    result[key] = (item as Record<string, unknown>)[key];
  }
  return result;
}

interface InMemoryListener<T> {
  eventTypes: StreamEventType[];
  callback: (item: T) => void | Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * In-memory repository for unit testing — no DynamoDB connection required.
 * Implements the same surface as {@link Repository} so tests are portable.
 */
export class InMemoryRepository<T extends object> {
  readonly #store = new Map<string, T>();
  readonly #schema: ResolvedSchema;
  readonly #listeners = new Set<InMemoryListener<T>>();

  constructor(schema: ResolvedSchema) {
    this.#schema = schema;
  }

  /** The resolved table name (includes any prefix/suffix applied by InMemoryDataSource). */
  get tableName(): string {
    return this.#schema.tableName;
  }

  // ── Key helpers ────────────────────────────────────────────────────────────

  #keyOf(item: Partial<T>): string {
    const h = this.#schema.hashKey;
    const r = this.#schema.rangeKey;
    const itemRec = item as Record<string, unknown>;
    const valH = itemRec[h] as string | number | boolean | undefined;
    const valR = r ? (itemRec[r] as string | number | boolean | undefined) : undefined;

    const hVal = typeof valH === 'object' ? JSON.stringify(valH) : String(valH ?? '');

    const rVal = r ? (typeof valR === 'object' ? JSON.stringify(valR) : String(valR ?? '')) : '';
    return r ? `${hVal}#${rVal}` : hVal;
  }

  #isSoftDeleted(item: T): boolean {
    if (!this.#schema.deleteDateKey) {
      return false;
    }
    return (
      (item as Record<string, unknown>)[this.#schema.deleteDateKey] !== null &&
      (item as Record<string, unknown>)[this.#schema.deleteDateKey] !== undefined
    );
  }

  #injectTimestamps(item: Record<string, unknown>, isCreate: boolean): void {
    const now = new Date();
    if (isCreate) {
      const createAttr = this.#findAttrByKind('createDate');
      if (createAttr) {
        item[createAttr] = now;
      }
    }
    const updateAttr = this.#findAttrByKind('updateDate');
    if (updateAttr) {
      item[updateAttr] = now;
    }
  }

  #findAttrByKind(kind: string): string | undefined {
    for (const [prop, attrName] of Object.entries(this.#schema.aliasMap)) {
      if (
        prop
          .toLowerCase()
          .includes(kind === 'createDate' ? 'createdat' : kind === 'updateDate' ? 'updatedat' : 'deletedat')
      ) {
        return attrName;
      }
    }
    return undefined;
  }

  // ── API ────────────────────────────────────────────────────────────────────

  create(data: Partial<T>): T {
    return {...data} as T;
  }

  subscribe(params: SubscribeParams<T>): Subscription {
    const {eventTypes, callback, options} = params;
    const listener: InMemoryListener<T> = {
      eventTypes,
      callback,
      onError: options?.onError ?? ((err: unknown): void => console.error('[in-memory] stream error:', err)),
    };
    this.#listeners.add(listener);
    return {
      close: async (): Promise<void> => {
        this.#listeners.delete(listener);
      },
    };
  }

  async #emit(eventType: StreamEventType, item: T): Promise<void> {
    for (const listener of this.#listeners) {
      if (listener.eventTypes.includes(eventType)) {
        try {
          await listener.callback({...item});
        } catch (err) {
          listener.onError(err);
        }
      }
    }
  }

  async save(item: T, _options?: WriteOptions): Promise<T> {
    const clone = {...item} as Record<string, unknown>;
    this.#injectTimestamps(clone, true);
    const key = this.#keyOf(clone as unknown as T);
    const existed = this.#store.has(key);
    this.#store.set(key, clone as unknown as T);
    await this.#emit(existed ? 'MODIFY' : 'INSERT', clone as unknown as T);
    return clone as unknown as T;
  }

  async update(key: Partial<T>, changes: Partial<T>, _options?: WriteOptions): Promise<T> {
    const k = this.#keyOf(key);
    const existing = this.#store.get(k);
    if (!existing) {
      throw new Error(`[in-memory] Entity not found for key: ${JSON.stringify(key)}`);
    }
    const updated = {...existing, ...changes} as Record<string, unknown>;
    this.#injectTimestamps(updated, false);
    this.#store.set(k, updated as unknown as T);
    await this.#emit('MODIFY', updated as unknown as T);
    return updated as unknown as T;
  }

  async findOneBy(key: Partial<T>, options: FindOptions = {}): Promise<T | undefined> {
    const item = this.#store.get(this.#keyOf(key));
    if (!item) {
      return undefined;
    }
    if (!options.withDeleted && this.#isSoftDeleted(item)) {
      return undefined;
    }
    return {...item};
  }

  async findOneByOrFail(key: Partial<T>, options: FindOptions = {}): Promise<T> {
    const result = await this.findOneBy(key, options);
    if (!result) {
      throw new Error(`[in-memory] Entity not found for key: ${JSON.stringify(key)}`);
    }
    return result;
  }

  async findByIndex<S extends SelectMap<T> | undefined = undefined>(
    attributeKey: keyof T & string,
    hashValue: unknown,
    options: FindOptions & {select?: S} = {}
  ): Promise<PaginatedResult<Projected<T, S>>> {
    let items = [...this.#store.values()].filter(i => (i as Record<string, unknown>)[attributeKey] === hashValue);
    if (!options.withDeleted) {
      items = items.filter(i => !this.#isSoftDeleted(i));
    }
    if (options.limit) {
      items = items.slice(0, options.limit);
    }
    const projected = items.map(i => projectItem({...i}, options.select)) as Projected<T, S>[];
    return {items: projected, count: projected.length};
  }

  async find<S extends SelectMap<T> | undefined = undefined>(
    hashValue: unknown,
    options: FindOptions & {select?: S} = {}
  ): Promise<PaginatedResult<Projected<T, S>>> {
    const hashKey = this.#schema.hashKey;
    let items = [...this.#store.values()].filter(i => (i as Record<string, unknown>)[hashKey] === hashValue);
    if (!options.withDeleted) {
      items = items.filter(i => !this.#isSoftDeleted(i));
    }
    if (options.limit) {
      items = items.slice(0, options.limit);
    }
    const projected = items.map(i => projectItem({...i}, options.select)) as Projected<T, S>[];
    return {items: projected, count: projected.length};
  }

  async findAll<S extends SelectMap<T> | undefined = undefined>(
    hashValue: unknown,
    options: Omit<FindOptions, 'startAt'> & {select?: S} = {}
  ): Promise<Projected<T, S>[]> {
    return (await this.find(hashValue, options as FindOptions & {select?: S})).items;
  }

  async scan<S extends SelectMap<T> | undefined = undefined>(
    options: FindOptions & {select?: S} = {}
  ): Promise<PaginatedResult<Projected<T, S>>> {
    let items = [...this.#store.values()];
    if (!options.withDeleted) {
      items = items.filter(i => !this.#isSoftDeleted(i));
    }
    if (options.limit) {
      items = items.slice(0, options.limit);
    }
    const projected = items.map(i => projectItem({...i}, options.select)) as Projected<T, S>[];
    return {items: projected, count: projected.length};
  }

  async scanAll<S extends SelectMap<T> | undefined = undefined>(
    options: Omit<FindOptions, 'startAt'> & {select?: S} = {}
  ): Promise<Projected<T, S>[]> {
    return (await this.scan(options as FindOptions & {select?: S})).items;
  }

  async count(options: CountOptions = {}): Promise<number> {
    const {items} = await this.scan(options);
    return items.length;
  }

  async delete(key: Partial<T>): Promise<void> {
    if (!this.#schema.deleteDateKey) {
      return this.hardDelete(key);
    }
    const k = this.#keyOf(key);
    const item = this.#store.get(k);
    if (!item) {
      return;
    }
    const updated = {
      ...item,
      [this.#schema.deleteDateKey]: new Date(),
    };
    this.#store.set(k, updated as T);
    await this.#emit('MODIFY', updated as T);
  }

  async hardDelete(key: Partial<T>): Promise<void> {
    const k = this.#keyOf(key);
    const item = this.#store.get(k);
    if (!item) {
      return;
    }
    this.#store.delete(k);
    await this.#emit('REMOVE', item);
  }

  async restore(key: Partial<T>): Promise<void> {
    if (!this.#schema.deleteDateKey) {
      return;
    }
    const k = this.#keyOf(key);
    const item = this.#store.get(k);
    if (!item) {
      return;
    }
    const updated = {...item, [this.#schema.deleteDateKey]: null};
    this.#store.set(k, updated as T);
    await this.#emit('MODIFY', updated as T);
  }

  async batchSave(items: T[]): Promise<void> {
    for (const item of items) {
      await this.save(item);
    }
  }

  async batchDelete(keys: Partial<T>[]): Promise<void> {
    for (const key of keys) {
      await this.hardDelete(key);
    }
  }

  async batchGet(keys: Partial<T>[]): Promise<(T | undefined)[]> {
    return Promise.all(keys.map(k => this.findOneBy(k)));
  }

  /** Direct store access for test assertions. */
  get store(): ReadonlyMap<string, T> {
    return this.#store;
  }

  /** Wipe all stored items (useful in beforeEach). */
  clear(): void {
    this.#store.clear();
  }
}
