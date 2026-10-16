import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { checkDynamoDb, checkMysql, mysqlTarget } from './startup-checks.js';

const logger = () => ({ log: vi.fn(), warn: vi.fn() });
const SECRET_TEXT = 'Access denied for user qa_admin@10.0.0.5 using password';
const allLogged = (l: ReturnType<typeof logger>) =>
  [...l.log.mock.calls, ...l.warn.mock.calls].flat().join('\n');

describe('mysqlTarget', () => {
  it('keeps host, port and database, never the credentials', () => {
    expect(mysqlTarget('mysql://qa_admin:p4ss@192.168.20.210:3306/qadb')).toBe(
      '192.168.20.210:3306/qadb',
    );
    expect(mysqlTarget('mysql://u:p@db.local/qa')).toBe('db.local:3306/qa');
    expect(mysqlTarget('not a url')).toBe('unparseable DATABASE_URL');
  });
});

describe('checkMysql', () => {
  it('logs the target when SELECT 1 answers', async () => {
    const l = logger();
    const ok = await checkMysql(
      { execute: vi.fn().mockResolvedValue([]) } as never,
      'h:3306/qadb',
      l,
    );
    expect(ok).toBe(true);
    expect(l.log).toHaveBeenCalledWith('MySQL connected: h:3306/qadb');
  });

  it('warns with the driver code only, never the message', async () => {
    const l = logger();
    const error = Object.assign(new Error(SECRET_TEXT), {
      code: 'ER_ACCESS_DENIED_ERROR',
    });
    const ok = await checkMysql(
      { execute: vi.fn().mockRejectedValue(error) } as never,
      'h:3306/qadb',
      l,
    );
    expect(ok).toBe(false);
    expect(l.warn).toHaveBeenCalledWith(
      'MySQL unreachable: h:3306/qadb reason=ER_ACCESS_DENIED_ERROR',
    );
    expect(allLogged(l)).not.toContain('qa_admin');
  });

  it('reports a timeout instead of hanging', async () => {
    const l = logger();
    const ok = await checkMysql(
      { execute: () => new Promise(() => undefined) } as never,
      'h:3306/qadb',
      l,
      20,
    );
    expect(ok).toBe(false);
    expect(l.warn).toHaveBeenCalledWith(
      'MySQL unreachable: h:3306/qadb reason=timeout',
    );
  });
});

describe('checkDynamoDb', () => {
  it('describes the table (read only) and logs its status and keys', async () => {
    const l = logger();
    const send = vi.fn().mockResolvedValue({
      Table: {
        TableStatus: 'ACTIVE',
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
      },
    });
    const ok = await checkDynamoDb(
      { send },
      'cgiar-qa-test',
      'explicit keys',
      l,
    );
    expect(ok).toBe(true);
    expect(send.mock.calls[0][0]).toBeInstanceOf(DescribeTableCommand);
    expect(send.mock.calls[0][0].input).toEqual({ TableName: 'cgiar-qa-test' });
    expect(l.log).toHaveBeenCalledWith(
      'DynamoDB connected: table=cgiar-qa-test status=ACTIVE keys=pk,sk credentials=explicit keys',
    );
  });

  it('warns with the AWS error name only', async () => {
    const l = logger();
    const error = Object.assign(
      new Error(`The security token ${SECRET_TEXT}`),
      {
        name: 'UnrecognizedClientException',
      },
    );
    const ok = await checkDynamoDb(
      { send: vi.fn().mockRejectedValue(error) },
      'cgiar-qa-test',
      'default chain',
      l,
    );
    expect(ok).toBe(false);
    expect(l.warn).toHaveBeenCalledWith(
      'DynamoDB unreachable: table=cgiar-qa-test credentials=default chain reason=UnrecognizedClientException',
    );
    expect(allLogged(l)).not.toContain('qa_admin');
  });

  it('aborts the request on timeout', async () => {
    const l = logger();
    let aborted = false;
    const send = vi.fn(
      (_command: unknown, options: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    );
    const ok = await checkDynamoDb(
      { send } as never,
      't',
      'explicit keys',
      l,
      20,
    );
    expect(ok).toBe(false);
    expect(aborted).toBe(true);
    expect(l.warn).toHaveBeenCalledWith(
      'DynamoDB unreachable: table=t credentials=explicit keys reason=timeout',
    );
  });
});
