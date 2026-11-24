import type { Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  type RequestWithId,
  requestIdMiddleware,
  requestIdOf,
} from './request-id.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requestWith(header?: unknown): RequestWithId {
  return {
    headers: header === undefined ? {} : { [REQUEST_ID_HEADER]: header },
  } as unknown as Request;
}

function run(request: RequestWithId) {
  const setHeader = vi.fn();
  const next = vi.fn();
  requestIdMiddleware(request, { setHeader } as unknown as Response, next);
  return { setHeader, next };
}

describe('requestIdMiddleware', () => {
  it('keeps a well-formed client id, exposes it on the request and in the header', () => {
    const request = requestWith('trace.id_1-2');
    const { setHeader, next } = run(request);
    expect(request.requestId).toBe('trace.id_1-2');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'trace.id_1-2');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['one with spaces', 'bad id'],
    ['an empty one', ''],
    ['one longer than 64 characters', 'a'.repeat(65)],
    ['one with a newline', 'abc\ndef'],
    ['a list', ['a', 'b']],
  ])('replaces %s with a fresh UUID', (_name, supplied) => {
    const request = requestWith(supplied);
    const { setHeader } = run(request);
    expect(request.requestId).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      request.requestId,
    );
  });

  it('gives a request without any id a fresh UUID', () => {
    const request = requestWith();
    run(request);
    expect(request.requestId).toMatch(UUID);
  });
});

describe('requestIdOf', () => {
  it('returns the id the middleware assigned', () => {
    const request = requestWith('abc-1');
    run(request);
    expect(requestIdOf(request)).toBe('abc-1');
  });

  it('assigns one, once, to a request that skipped the middleware', () => {
    const request = requestWith('abc-2');
    expect(requestIdOf(request)).toBe('abc-2');
    const bare = requestWith();
    const first = requestIdOf(bare);
    expect(first).toMatch(UUID);
    expect(requestIdOf(bare)).toBe(first);
  });
});
