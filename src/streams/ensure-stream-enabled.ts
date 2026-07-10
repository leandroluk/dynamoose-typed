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

  // Known v1 limitation (not handled here): changing an existing table's `stream` view
  // type after it's already enabled is not supported by this helper. AWS rejects an
  // `UpdateTable` that changes `StreamViewType` on an already-enabled stream in one call
  // (`ValidationException`) — it requires a disable-then-re-enable sequence, which this
  // function does not perform. If you change `@DynamoTable`'s `stream` option on a table
  // that already has streams enabled with a different view type, disable and re-enable
  // the stream manually (e.g. via the AWS console/CLI) before the next `subscribe()` call.
  if (spec?.StreamEnabled && spec.StreamViewType === viewType) {
    return described.Table!.LatestStreamArn!;
  }

  const updated = await client.updateTable({
    TableName: tableName,
    StreamSpecification: {StreamEnabled: true, StreamViewType: viewType},
  });
  return updated.TableDescription!.LatestStreamArn!;
}
