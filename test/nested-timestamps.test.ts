import {InternalModel} from '#/model/internal-model';
import {resolveTableSchema} from '#/schema';
import type * as dynamoose from 'dynamoose';
import {describe, expect, it, vi} from 'vitest';
import {AuditedOrderTable} from './fixtures';

// ── Minimal dModel stub — we only test injection, not DynamoDB calls ──────────
function makeStubModel() {
  return {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    query: vi.fn(),
    scan: vi.fn(),
    batchPut: vi.fn(),
    batchDelete: vi.fn(),
    batchGet: vi.fn(),
  } as unknown as ReturnType<typeof dynamoose.model>;
}

function makeModel() {
  const schema = resolveTableSchema(AuditedOrderTable);
  return new InternalModel(AuditedOrderTable, schema, makeStubModel());
}

describe('injectCreateTimestamps — nested subdocs', () => {
  it('injects timestamps on the root document', () => {
    const model = makeModel();
    const item = {id: '1'} as Record<string, unknown>;
    model.injectCreateTimestamps(item);

    expect(typeof item['created_at']).toBe('number');
    expect(typeof item['updated_at']).toBe('number');
  });

  it('injects timestamps into a nested @DynamoDocument', () => {
    const model = makeModel();
    const addr: Record<string, unknown> = {street: 'Rua A'};
    const item = {id: '1', address: addr} as Record<string, unknown>;

    model.injectCreateTimestamps(item);

    expect(typeof addr['created_at']).toBe('number');
    expect(typeof addr['updated_at']).toBe('number');
  });

  it('injects timestamps into every element of an array of @DynamoDocument', () => {
    const model = makeModel();
    const line1: Record<string, unknown> = {sku: 'A', qty: 1};
    const line2: Record<string, unknown> = {sku: 'B', qty: 2};
    const item = {id: '1', items: [line1, line2]} as Record<string, unknown>;

    model.injectCreateTimestamps(item);

    expect(typeof line1['created_at']).toBe('number');
    expect(typeof line1['updated_at']).toBe('number');
    expect(typeof line2['created_at']).toBe('number');
    expect(typeof line2['updated_at']).toBe('number');
  });

  it('does not throw when nested field is absent (undefined)', () => {
    const model = makeModel();
    const item = {id: '1'} as Record<string, unknown>; // no address, no items
    expect(() => model.injectCreateTimestamps(item)).not.toThrow();
  });
});

describe('injectUpdateTimestamp — nested subdocs', () => {
  it('updates only updatedAt on root', () => {
    const model = makeModel();
    const item = {id: '1'} as Record<string, unknown>;
    model.injectUpdateTimestamp(item);

    expect(typeof item['updated_at']).toBe('number');
    expect(item['created_at']).toBeUndefined();
  });

  it('updates only updatedAt in nested document', () => {
    const model = makeModel();
    const addr: Record<string, unknown> = {street: 'Rua B'};
    const item = {id: '1', address: addr} as Record<string, unknown>;

    model.injectUpdateTimestamp(item);

    expect(typeof addr['updated_at']).toBe('number');
    expect(addr['created_at']).toBeUndefined();
  });

  it('updates only updatedAt in each array element', () => {
    const model = makeModel();
    const line: Record<string, unknown> = {sku: 'C', qty: 3};
    const item = {id: '1', items: [line]} as Record<string, unknown>;

    model.injectUpdateTimestamp(item);

    expect(typeof line['updated_at']).toBe('number');
    expect(line['created_at']).toBeUndefined();
  });

  it('root and nested timestamps are the same value (same now)', () => {
    const model = makeModel();
    const addr: Record<string, unknown> = {street: 'Rua C'};
    const line: Record<string, unknown> = {sku: 'D', qty: 1};
    const item = {id: '1', address: addr, items: [line]} as Record<string, unknown>;

    const before = Date.now();
    model.injectCreateTimestamps(item);
    const after = Date.now();

    const rootTs = item['created_at'] as number;
    const addrTs = addr['created_at'] as number;
    const lineTs = line['created_at'] as number;

    // All three timestamps must be the same value (same `now` captured once)
    expect(rootTs).toBe(addrTs);
    expect(rootTs).toBe(lineTs);
    expect(rootTs).toBeGreaterThanOrEqual(before);
    expect(rootTs).toBeLessThanOrEqual(after);
  });
});
