import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Readable } from 'node:stream';

type Av = Record<string, Record<string, unknown>>;

/**
 * A DynamoDBClient whose HTTP layer is an in-memory table keyed by pk/sk.
 * It answers PutItem (with `attribute_not_exists`), GetItem and Query
 * (`pk = :pk AND begins_with(sk, :sk)`), so ElectroDB's real requests run.
 */
export function createFakeDynamoClient(): {
  client: DynamoDBClient;
  items: Map<string, Av>;
} {
  const items = new Map<string, Av>();
  const s = (v: Record<string, unknown> | undefined) => v?.S as string;
  const reply = (status: number, body: unknown) => ({
    response: {
      statusCode: status,
      headers: { 'content-type': 'application/x-amz-json-1.0' },
      body: Readable.from([Buffer.from(JSON.stringify(body))]),
    },
  });
  const handler = {
    handle(request: {
      headers: Record<string, string>;
      body: Uint8Array | string;
    }) {
      const op = request.headers['x-amz-target'].split('.')[1];
      const input = JSON.parse(Buffer.from(request.body).toString('utf8')) as {
        Item?: Av;
        Key?: Av;
        ConditionExpression?: string;
        ExpressionAttributeValues?: Av;
      };
      if (op === 'PutItem') {
        const key = `${s(input.Item!.pk)}|${s(input.Item!.sk)}`;
        if (input.ConditionExpression && items.has(key))
          return Promise.resolve(
            reply(400, {
              __type:
                'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException',
              message: 'The conditional request failed',
            }),
          );
        items.set(key, input.Item!);
        return Promise.resolve(reply(200, {}));
      }
      if (op === 'GetItem') {
        const item = items.get(`${s(input.Key!.pk)}|${s(input.Key!.sk)}`);
        return Promise.resolve(reply(200, item ? { Item: item } : {}));
      }
      if (op === 'Query') {
        const vals = Object.values(input.ExpressionAttributeValues!).map((v) =>
          s(v),
        );
        const pk = vals.find((v) => v.startsWith('RESULT#'))!;
        const prefix = vals.find((v) => v.startsWith('SNAP#'))!;
        const rows = [...items.values()]
          .filter((i) => s(i.pk) === pk && s(i.sk).startsWith(prefix))
          .sort((a, b) => (s(a.sk) < s(b.sk) ? -1 : 1));
        return Promise.resolve(reply(200, { Items: rows, Count: rows.length }));
      }
      return Promise.resolve(
        reply(400, { __type: 'ValidationException', message: op }),
      );
    },
    destroy() {},
    updateHttpClientConfig() {},
    httpHandlerConfigs: () => ({}),
  };
  const client = new DynamoDBClient({
    region: 'us-east-1',
    credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
    requestHandler: handler as never,
    maxAttempts: 1,
  });
  return { client, items };
}
