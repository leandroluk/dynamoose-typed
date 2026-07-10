import type {StreamViewType} from '#/types';

export interface DescribeUpdateTableClient {
  describeTable(input: {TableName: string}): Promise<{
    Table?: {
      LatestStreamArn?: string;
      StreamSpecification?: {StreamEnabled?: boolean; StreamViewType?: string};
    };
  }>;
  updateTable(input: {
    TableName: string;
    StreamSpecification: {StreamEnabled: boolean; StreamViewType: StreamViewType};
  }): Promise<{TableDescription?: {LatestStreamArn?: string}}>;
}

/**
 * Ensures the physical table has DynamoDB Streams enabled with the requested view type,
 * enabling/updating it via `UpdateTable` if necessary. Returns the stream's ARN.
 */
export async function ensureStreamEnabled(
  client: DescribeUpdateTableClient,
  tableName: string,
  viewType: StreamViewType
): Promise<string> {
  const described = await client.describeTable({TableName: tableName});
  const spec = described.Table?.StreamSpecification;

  if (spec?.StreamEnabled && spec.StreamViewType === viewType) {
    return described.Table!.LatestStreamArn!;
  }

  const updated = await client.updateTable({
    TableName: tableName,
    StreamSpecification: {StreamEnabled: true, StreamViewType: viewType},
  });
  return updated.TableDescription!.LatestStreamArn!;
}
