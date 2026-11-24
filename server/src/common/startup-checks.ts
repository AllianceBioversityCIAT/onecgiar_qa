import {
  DescribeTableCommand,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { mysqlConfig } from '../config/mysql.config.js';
import { dynamoDbConfig } from '../config/dynamodb.config.js';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  DYNAMODB_CLIENT,
  DYNAMODB_TABLE_NAME,
} from '../database/dynamodb/dynamodb.constants.js';
import { errorFacts } from './http-exception.filter.js';

/** How long a startup check may take before it is reported as a timeout. */
export const STARTUP_CHECK_TIMEOUT_MS = 5_000;

type CheckLogger = Pick<Logger, 'log' | 'warn'>;

const IDENTIFIER = /^\w{1,64}$/;

/**
 * Why a check failed, from fixed fields only: a driver code (`ETIMEDOUT`,
 * `ER_ACCESS_DENIED_ERROR`) or an error class (`UnrecognizedClientException`).
 * Never the message: it can carry the user name, the host or a query.
 */
function reasonOf(error: unknown): string {
  if (error instanceof TimeoutError) return 'timeout';
  const facts = errorFacts(error);
  const name = (error as { name?: unknown } | null)?.name;
  return (
    facts.code ??
    (typeof name === 'string' && IDENTIFIER.test(name) ? name : facts.error)
  );
}

class TimeoutError extends Error {}

function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Reject first, so the race reports the timeout, then cancel the call.
      reject(new TimeoutError());
      controller.abort();
    }, ms);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

/** Where MySQL lives, without credentials: `host:port/database`. */
export function mysqlTarget(url: string): string {
  try {
    const { hostname, port, pathname } = new URL(url);
    return `${hostname}:${port || 3306}${pathname || '/'}`;
  } catch {
    return 'unparseable DATABASE_URL';
  }
}

/** `SELECT 1` on the pool: logs whether MySQL answers. Never throws. */
export async function checkMysql(
  db: Pick<DrizzleDB, 'execute'>,
  target: string,
  logger: CheckLogger,
  timeoutMs = STARTUP_CHECK_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await withTimeout(() => db.execute(sql`select 1`), timeoutMs);
    logger.log(`MySQL connected: ${target}`);
    return true;
  } catch (error) {
    logger.warn(`MySQL unreachable: ${target} reason=${reasonOf(error)}`);
    return false;
  }
}

/** `DescribeTable` (read only): logs whether the table answers, and its keys. Never throws. */
export async function checkDynamoDb(
  client: Pick<DynamoDBClient, 'send'>,
  tableName: string,
  credentials: 'explicit keys' | 'default chain',
  logger: CheckLogger,
  timeoutMs = STARTUP_CHECK_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const { Table } = await withTimeout(
      (abortSignal) =>
        client.send(new DescribeTableCommand({ TableName: tableName }), {
          abortSignal,
        }),
      timeoutMs,
    );
    const keys = (Table?.KeySchema ?? [])
      .map((key) => key.AttributeName)
      .join(',');
    logger.log(
      `DynamoDB connected: table=${tableName} status=${Table?.TableStatus ?? 'unknown'} keys=${keys} credentials=${credentials}`,
    );
    return true;
  } catch (error) {
    logger.warn(
      `DynamoDB unreachable: table=${tableName} credentials=${credentials} reason=${reasonOf(error)}`,
    );
    return false;
  }
}

/**
 * Logs, once at startup, whether MySQL and DynamoDB answer. Runs in the
 * background (never delays or stops the API: a dependency down at boot may
 * come back) and only from `main.ts`, so the e2e suites, which have no
 * database, stay quiet.
 */
export function runStartupChecks(app: NestExpressApplication): void {
  const logger = new Logger('StartupChecks');
  const mysql = app.get(mysqlConfig.KEY, { strict: false });
  const dynamo = app.get(dynamoDbConfig.KEY, { strict: false });
  void checkMysql(
    app.get<DrizzleDB>(DRIZZLE, { strict: false }),
    mysqlTarget(mysql.url),
    logger,
  );
  void checkDynamoDb(
    app.get<DynamoDBClient>(DYNAMODB_CLIENT, { strict: false }),
    app.get<string>(DYNAMODB_TABLE_NAME, { strict: false }),
    dynamo.credentials ? 'explicit keys' : 'default chain',
    logger,
  );
}
