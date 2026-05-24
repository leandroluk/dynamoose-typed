import {DynamoTable, StringAttribute} from '#';
import {resolveTableSchema} from '#/schema';
import {describe, expect, it} from 'vitest';

describe('throughput in TableOptions', () => {
  it('includes throughput in tableOptions when set to ON_DEMAND', () => {
    @DynamoTable('throughput-on-demand', {throughput: 'ON_DEMAND'})
    class ThroughputOnDemandTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }
    const schema = resolveTableSchema(ThroughputOnDemandTable);
    expect(schema.tableOptions['throughput']).toBe('ON_DEMAND');
  });

  it('includes throughput in tableOptions when set to a number', () => {
    @DynamoTable('throughput-number', {throughput: 10})
    class ThroughputNumberTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }
    const schema = resolveTableSchema(ThroughputNumberTable);
    expect(schema.tableOptions['throughput']).toBe(10);
  });

  it('includes throughput in tableOptions when set to read/write object', () => {
    @DynamoTable('throughput-obj', {throughput: {read: 5, write: 10}})
    class ThroughputObjTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }
    const schema = resolveTableSchema(ThroughputObjTable);
    expect(schema.tableOptions['throughput']).toEqual({read: 5, write: 10});
  });

  it('tableOptions has no throughput key when not set', () => {
    @DynamoTable('throughput-absent')
    class ThroughputAbsentTable {
      @StringAttribute({hashKey: true})
      id!: string;
    }
    const schema = resolveTableSchema(ThroughputAbsentTable);
    expect(schema.tableOptions['throughput']).toBeUndefined();
  });
});
