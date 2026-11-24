import { describe, expect, it } from 'vitest';
import { requestFingerprint } from './fingerprint.js';

// FR-4: the same key with a different request is refused, so two requests are
// "the same" exactly when method, path (ids included, query excluded) and the
// parsed JSON body agree, whatever the key order or whitespace of the wire form.

const fp = (path: string, body: unknown, method = 'POST') =>
  requestFingerprint({ method, path, body });
const parse = (json: string) => JSON.parse(json) as unknown;

describe('requestFingerprint', () => {
  it('is a sha256 hex digest', () => {
    expect(fp('/users', { a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  // Independent vectors: computed outside the code under test with
  //   printf 'POST\n/users/5\n{"a":1,"b":[{"c":null,"d":"x y"},2]}' | shasum -a 256
  it('hashes method, path and the canonical body, newline-separated, to a known digest', () => {
    expect(
      fp('/users/5', { b: [{ d: 'x y', c: null }, 2], a: 1 }, 'POST'),
    ).toBe('952fe3062241eb075398973bb11602f24fcb9a04b274a2da21f5c6e7af863ab3');
    expect(fp('/users/5/exclusions/9', undefined, 'DELETE')).toBe(
      'cdec9a7b13993601dfd7e27ba3b204842df51e0adb1a6c69c97d9b96e4698f06',
    );
  });

  // [label, request A, request B, same fingerprint?]
  const rows: Array<[string, [string, unknown], [string, unknown], boolean]> = [
    [
      'top-level key order',
      ['/u', { a: 1, b: 2 }],
      ['/u', { b: 2, a: 1 }],
      true,
    ],
    [
      'nested key order',
      ['/u', { x: { a: 1, b: { c: 1, d: 2 } } }],
      ['/u', { x: { b: { d: 2, c: 1 }, a: 1 } }],
      true,
    ],
    [
      'key order inside objects held by arrays',
      ['/u', { l: [{ a: 1, b: 2 }] }],
      ['/u', { l: [{ b: 2, a: 1 }] }],
      true,
    ],
    [
      'array order matters',
      ['/u', { l: [1, 2] }],
      ['/u', { l: [2, 1] }],
      false,
    ],
    [
      'array order matters for objects too',
      ['/u', [{ a: 1 }, { a: 2 }]],
      ['/u', [{ a: 2 }, { a: 1 }]],
      false,
    ],
    [
      'whitespace outside strings in the wire body',
      ['/u', parse('{ "a" : 1,\n "b":[ 1 , 2 ] }')],
      ['/u', parse('{"b":[1,2],"a":1}')],
      true,
    ],
    [
      'whitespace inside a string value is data',
      ['/u', { n: 'a b' }],
      ['/u', { n: 'a  b' }],
      false,
    ],
    [
      'an id in the path',
      ['/users/5', { a: 1 }],
      ['/users/6', { a: 1 }],
      false,
    ],
    [
      'the query string is ignored',
      ['/users/5?notify=1', { a: 1 }],
      ['/users/5', { a: 1 }],
      true,
    ],
    [
      'a different query string is ignored',
      ['/users/5?x=1', { a: 1 }],
      ['/users/5?y=2#top', { a: 1 }],
      true,
    ],
    [
      'same body, different path',
      ['/users/5/invitation', { a: 1 }],
      ['/users/5/roles', { a: 1 }],
      false,
    ],
    ['a number vs its string', ['/u', { a: 1 }], ['/u', { a: '1' }], false],
    ['null vs a missing key', ['/u', { a: null }], ['/u', {}], false],
    ['null body vs an empty object', ['/u', null], ['/u', {}], false],
    ['no body vs a null body', ['/u', undefined], ['/u', null], true],
    [
      'structure is not flattened',
      ['/u', { a: { b: 1 }, c: 2 }],
      ['/u', { a: { b: 1, c: 2 } }],
      false,
    ],
    [
      'an own "__proto__" key is data, not a prototype',
      ['/u', parse('{"__proto__":{"admin":true}}')],
      ['/u', {}],
      false,
    ],
    [
      'a boolean vs a string',
      ['/u', { a: true }],
      ['/u', { a: 'true' }],
      false,
    ],
  ];

  it.each(rows)('%s', (_label, [pathA, bodyA], [pathB, bodyB], same) => {
    const a = fp(pathA, bodyA);
    const b = fp(pathB, bodyB);
    if (same) expect(a).toBe(b);
    else expect(a).not.toBe(b);
  });

  it('a different method on the same path and body differs', () => {
    expect(fp('/users/5', undefined, 'PUT')).not.toBe(
      fp('/users/5', undefined, 'DELETE'),
    );
  });

  it('the method is case-insensitive', () => {
    expect(fp('/u', { a: 1 }, 'post')).toBe(fp('/u', { a: 1 }, 'POST'));
  });
});
