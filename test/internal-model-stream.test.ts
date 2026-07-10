import {InternalModel} from '#/model/internal-model';
import {resolveTableSchema, type ResolvedSchema} from '#/schema';
import {describe, expect, it, vi} from 'vitest';
import {UserTable} from './fixtures';

const describeTable = vi.fn();
const updateTable = vi.fn();
const ddbInstance = {describeTable, updateTable, config: {region: 'us-east-1'}};

vi.mock('dynamoose', () => ({
  default: {
    aws: {ddb: vi.fn(() => ddbInstance)},
  },
}));

const streamsClientInstances: {describeStream: ReturnType<typeof vi.fn>}[] = [];
vi.mock('@aws-sdk/client-dynamodb-streams', () => ({
  DynamoDBStreams: vi.fn().mockImplementation(function DynamoDBStreamsMock() {
    const instance = {describeStream: vi.fn(), getShardIterator: vi.fn(), getRecords: vi.fn()};
    streamsClientInstances.push(instance);
    return instance;
  }),
}));

function makeStreamSchema(): ResolvedSchema {
  return {...resolveTableSchema(UserTable), streamViewType: 'NEW_AND_OLD_IMAGES'};
}

describe('InternalModel.getStreamPoller', () => {
  it('bootstraps the stream (ensureStreamEnabled + StreamPoller) on first call', async () => {
    describeTable.mockResolvedValue({
      Table: {
        LatestStreamArn: 'arn:1',
        StreamSpecification: {StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES'},
      },
    });
    streamsClientInstances.length = 0;

    const model = new InternalModel(UserTable, makeStreamSchema(), {} as never);
    const poller = await model.getStreamPoller();

    expect(poller.listenerCount).toBe(0);
    expect(updateTable).not.toHaveBeenCalled();
    expect(streamsClientInstances).toHaveLength(1);
  });

  it('reuses the same poller instance on subsequent calls (no second bootstrap)', async () => {
    describeTable.mockClear();
    describeTable.mockResolvedValue({
      Table: {
        LatestStreamArn: 'arn:1',
        StreamSpecification: {StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES'},
      },
    });
    streamsClientInstances.length = 0;

    const model = new InternalModel(UserTable, makeStreamSchema(), {} as never);
    const [pollerA, pollerB] = await Promise.all([model.getStreamPoller(), model.getStreamPoller()]);

    expect(pollerA).toBe(pollerB);
    expect(describeTable).toHaveBeenCalledTimes(1);
    expect(streamsClientInstances).toHaveLength(1);
  });

  it('retries bootstrap on subsequent calls if the first attempt fails (does not cache rejection)', async () => {
    describeTable.mockClear();
    describeTable.mockRejectedValueOnce(new Error('throttled'));
    describeTable.mockResolvedValueOnce({
      Table: {
        LatestStreamArn: 'arn:1',
        StreamSpecification: {StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES'},
      },
    });
    streamsClientInstances.length = 0;

    const model = new InternalModel(UserTable, makeStreamSchema(), {} as never);

    // First call: expect the rejection
    await expect(model.getStreamPoller()).rejects.toThrow('throttled');

    // Second call on the SAME model: expect it to succeed (bootstrap retried)
    const poller = await model.getStreamPoller();
    expect(poller.listenerCount).toBe(0);

    // Verify describeTable was called twice: once for the failed attempt, once for the successful retry
    expect(describeTable).toHaveBeenCalledTimes(2);
    expect(streamsClientInstances).toHaveLength(1);
  });
});
