/**
 * Thrown when an `update()` fails because the `@VersionAttribute` condition was not met —
 * i.e., another process modified the item between the read and the write.
 */
export class OptimisticLockError extends Error {
  constructor(key?: unknown) {
    super(
      `[dynamoose-typed] Optimistic lock conflict: item was modified by another process.${key !== undefined ? ` Key: ${JSON.stringify(key)}` : ''}`
    );
    this.name = 'OptimisticLockError';
  }
}
