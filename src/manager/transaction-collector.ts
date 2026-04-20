import type {InternalModel} from '#/model/internal-model';
import dynamoose from 'dynamoose';
import {type InputKey} from 'dynamoose/dist/General';

type TxOp =
  | {type: 'create'; model: InternalModel<object>; item: Record<string, unknown>}
  | {type: 'update'; model: InternalModel<object>; key: Record<string, unknown>; changes: Record<string, unknown>}
  | {type: 'delete'; model: InternalModel<object>; key: Record<string, unknown>};

/**
 * Accumulates write operations during a `dataSource.transaction()` callback
 * and flushes them all atomically via `dynamoose.transaction()` at the end.
 *
 * Reads (findOneBy, find, scan, count) are executed immediately — DynamoDB
 * transactions only support atomic writes, so reads inside a transaction
 * reflect the pre-transaction state (same as DynamoDB TransactGetItems).
 */
export class TransactionCollector {
  readonly #ops: TxOp[] = [];

  enqueueCreate(model: InternalModel<object>, item: Record<string, unknown>): void {
    this.#ops.push({type: 'create', model, item});
  }

  enqueueUpdate(model: InternalModel<object>, key: Record<string, unknown>, changes: Record<string, unknown>): void {
    this.#ops.push({type: 'update', model, key, changes});
  }

  enqueueDelete(model: InternalModel<object>, key: Record<string, unknown>): void {
    this.#ops.push({type: 'delete', model, key});
  }

  get size(): number {
    return this.#ops.length;
  }

  /**
   * Builds dynamoose transaction condition objects and executes them atomically.
   * Throws if the transaction fails (DynamoDB TransactionCanceledException).
   */
  async flush(): Promise<void> {
    if (this.#ops.length === 0) {
      return;
    }

    const conditions = this.#ops.map(op => {
      switch (op.type) {
        case 'create':
          return op.model.raw.transaction.create(op.item);
        case 'update':
          return op.model.raw.transaction.update(op.key as object, op.changes);
        case 'delete':
          return op.model.raw.transaction.delete(op.key as InputKey);
      }
    });

    await (dynamoose.transaction as (c: unknown[]) => Promise<void>)(conditions);
  }
}
