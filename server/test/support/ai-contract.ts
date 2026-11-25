// @akili-spec assessment/ai-suggestions
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

/** The copy of the worker contract (T-2): `src/ai-suggestions/contract/`. */
export const AI_CONTRACT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/ai-suggestions/contract',
);

export type AiSchemaName =
  | 'ai-job-message'
  | 'ai-run-item'
  | 'ai-suggestion-event'
  | 'ai-suggestion-item'
  | 'ai-suggestion-view';

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8')) as unknown;

let ajv: Ajv2020 | undefined;
const compiled = new Map<AiSchemaName, ValidateFunction>();

/**
 * A validator for one of the worker's schemas (Pydantic, JSON Schema 2020-12).
 * `discriminator` carries an OpenAPI `mapping` Ajv does not take, so it is an
 * annotation here: the `oneOf` alone decides. `x-contractVersion` is one too.
 */
export function aiSchema(name: AiSchemaName): ValidateFunction {
  let fn = compiled.get(name);
  if (fn) return fn;
  ajv ??= new Ajv2020({ allErrors: true, strict: true })
    .addKeyword('discriminator')
    // Contract 2.0.0 stamps every schema with its version (an annotation).
    .addKeyword('x-contractVersion');
  fn = ajv.compile(
    readJson(join(AI_CONTRACT_DIR, 'schema', `${name}.schema.json`)) as object,
  );
  compiled.set(name, fn);
  return fn;
}

/** Asserts `value` is valid against the schema; throws with Ajv's errors otherwise. */
export function assertAiSchema(name: AiSchemaName, value: unknown): void {
  const fn = aiSchema(name);
  if (!fn(value)) {
    throw new Error(
      `${name}: ${JSON.stringify(fn.errors)} for ${JSON.stringify(value)}`,
    );
  }
}

/** The worker's example items, by file name. */
export function aiExamples(): Record<string, Record<string, unknown>> {
  const dir = join(AI_CONTRACT_DIR, 'examples');
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f, readJson(join(dir, f)) as Record<string, unknown>]),
  );
}

/** A plain JSON item as a DynamoDB attribute map, the way boto3 writes it. */
export function toAttributeMap(
  item: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const av = (v: unknown): Record<string, unknown> => {
    if (v === null) return { NULL: true };
    if (typeof v === 'string') return { S: v };
    if (typeof v === 'number') return { N: String(v) };
    if (typeof v === 'boolean') return { BOOL: v };
    // Contract 2.0.0: use numbers are lists of maps, reported values maps.
    if (Array.isArray(v)) return { L: v.map(av) };
    if (typeof v === 'object') {
      return {
        M: Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([k, x]) => [
            k,
            av(x),
          ]),
        ),
      };
    }
    throw new Error(`unsupported attribute ${JSON.stringify(v)}`);
  };
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, av(v)]));
}
