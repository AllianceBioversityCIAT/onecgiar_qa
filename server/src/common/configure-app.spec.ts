import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isFieldConfigDraftJson } from './configure-app.js';

const call = (method: string, url: string, contentType?: string) =>
  isFieldConfigDraftJson({
    method,
    url,
    path: url.split('?')[0],
    headers: contentType === undefined ? {} : { 'content-type': contentType },
  } as IncomingMessage);

describe('isFieldConfigDraftJson (R-5, FR-5, NFR-2: the larger body limit is scoped to one route)', () => {
  it.each([
    ['PATCH', '/api/v1/cycles/7/field-config/draft', 'application/json'],
    ['PATCH', '/api/v1/cycles/7/field-config/draft/', 'application/json'],
    [
      'PATCH',
      '/api/v1/cycles/7/field-config/draft?x=1',
      'Application/JSON; charset=utf-8',
    ],
  ])('%s %s is the draft edit', (method, url, type) => {
    expect(call(method, url, type)).toBe(true);
  });

  it.each([
    ['POST', '/api/v1/cycles/7/field-config/draft', 'application/json'],
    ['PATCH', '/api/v1/cycles/7/field-config/publish', 'application/json'],
    ['PATCH', '/api/v1/cycles/7/field-config/draft/x', 'application/json'],
    ['PATCH', '/api/v1/cycles', 'application/json'],
    ['PATCH', '/cycles/7/field-config/draft', 'application/json'],
    ['PATCH', '/api/v1/cycles/7/field-config/draft', 'text/plain'],
    ['PATCH', '/api/v1/cycles/7/field-config/draft', undefined],
    ['PATCH', '/api/v1/cycles/7/field-config/draft', 'a b/json'],
    ['PATCH', '/api/v1/cycles/7/field-config/draft', 'json'],
  ])('%s %s (%s) is not', (method, url, type) => {
    expect(call(method, url, type)).toBe(false);
  });
});
