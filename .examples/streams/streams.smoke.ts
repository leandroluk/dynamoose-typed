/**
 * Streams smoke test against a real LocalStack instance.
 *
 * Run: `pnpm exec vitest run --config .examples/streams/vitest.config.ts`
 * (LocalStack must be running with DynamoDB + DynamoDB Streams, default http://localhost:4566)
 *
 * Root cause of "doesn't work against LocalStack": `DataSource({ local: true })` calls
 * `dynamoose.aws.ddb.local(endpoint)`, which builds `new DynamoDB({ endpoint })` with NO
 * region/credentials set. The AWS SDK v3 default provider chain then tries to resolve those
 * from the environment — against DynamoDB Local this often works by accident (no auth checks,
 * region mostly ignored), but LocalStack is stricter: without a resolvable region/credentials,
 * client construction or the `DynamoDBStreams` calls fail. Fix: pass a fully-configured client
 * (region + endpoint + dummy credentials) via `DataSourceOptions.client` instead of `local: true`.
 */
import {DataSource, DynamoTable, StringAttribute, type Subscription} from '#';
import {DynamoDB} from '@aws-sdk/client-dynamodb';
import {describe, expect, it} from 'vitest';

const ENDPOINT = process.env['LOCALSTACK_ENDPOINT'] ?? 'http://localhost:4566';

@DynamoTable('streams_smoke_test', {stream: true})
class SmokeItem {
  @StringAttribute({hashKey: true, required: true})
  id = '';

  @StringAttribute()
  status = '';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('streams against LocalStack', () => {
  it('observes INSERT/MODIFY/REMOVE via Repository.subscribe()', async () => {
    const client = new DynamoDB({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      credentials: {accessKeyId: 'test', secretAccessKey: 'test'},
    });

    const dataSource = new DataSource({entities: [SmokeItem], client});
    await dataSource.initialize();

    const alive = await dataSource.ping();
    console.log(`[ping] LocalStack reachable at ${ENDPOINT}:`, alive);
    expect(alive, `Could not reach LocalStack at ${ENDPOINT}. Is it running?`).toBe(true);

    const repo = dataSource.getRepository(SmokeItem);

    // Force the physical table to exist (and become ACTIVE) before subscribing:
    // `new dynamoose.Table(...)` schedules table creation lazily/asynchronously — it does
    // NOT block `dataSource.initialize()`. `subscribe()` calls `describeTable` immediately
    // (to enable the stream), so on a brand-new table it can race the CreateTable call and
    // fail with `ResourceNotFoundException`. A real long-lived service normally has already
    // written to the table before it subscribes, so this race is only visible on a fresh run.
    const warmupId = `warmup-${Date.now()}`;
    await repo.save({id: warmupId, status: 'warmup'});
    await repo.hardDelete({id: warmupId});

    const seen: string[] = [];

    const subscription: Subscription = repo.subscribe({
      eventTypes: ['INSERT', 'MODIFY', 'REMOVE'],
      callback: (item, meta) => {
        seen.push(meta.eventName);
        console.log(`[stream] ${meta.eventName}`, {item, oldItem: meta.oldItem});
      },
      options: {onError: err => console.error('[stream] error:', err)},
    });

    // First subscribe() call lazily enables the stream + starts the poller — give it a
    // moment to call describeStream/getShardIterator before we start writing.
    await delay(2000);

    const id = `smoke-${Date.now()}`;
    console.log('[write] insert', id);
    await repo.save({id, status: 'created'});
    await delay(1500);

    console.log('[write] update', id);
    await repo.update({id}, {status: 'updated'});
    await delay(1500);

    console.log('[write] delete', id);
    await repo.hardDelete({id});
    await delay(1500);

    await subscription.close();

    console.log('[result] events observed:', seen);
    expect(seen).toEqual(expect.arrayContaining(['INSERT', 'MODIFY', 'REMOVE']));
  });
});
