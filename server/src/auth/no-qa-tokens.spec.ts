import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// FR-17, "Static guarantee": `server/` contains no token signing and no
// Cognito client secret. Tokens are the pool's: this API only verifies them.
//
// What is scanned, and why. The production surface: every `.ts` file under
// `server/src` except the specs (`*.spec.ts`), plus the files that configure
// the server (package.json, .env.example, the Nest, Vitest and Drizzle
// configs, README). What is not scanned: the specs, and `server/test/`, which
// legitimately mint tokens with locally generated keys (`test/support/
// jwt-test-keys.ts`) to exercise the verifier; none of that is shipped (the
// build, `tsconfig.build.json`, leaves both out of `dist`). A signing helper
// added under `src` is scanned wherever it hides, so it is caught.

const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC_ROOT = join(SERVER_ROOT, 'src');

const SIGNING = [
  /\bsign(?:Async|Sync|Jwt|Token|AccessToken|IdToken|RefreshToken)?\s*\(/i,
  /\bcreateSign\b/,
  /\bcreateHmac\b/,
  /\bSignJWT\b/,
  /['"](?:jsonwebtoken|jose|jws|jwa|njwt|fast-jwt|@nestjs\/jwt)['"]/,
];

const CLIENT_SECRET = /client[_-]?secret/i;

/** Source lines with the lines that only hold a comment left out. */
function codeOf(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

const findSigning = (text: string): string[] => {
  const code = codeOf(text);
  return SIGNING.flatMap((pattern) => {
    const match = pattern.exec(code);
    return match === null ? [] : [match[0]];
  });
};

const hasClientSecret = (text: string): boolean =>
  CLIENT_SECRET.test(codeOf(text));

const isSpec = (path: string) => path.endsWith('.spec.ts');

function sourceFiles(): string[] {
  return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !isSpec(path));
}

const CONFIG_FILES = [
  'package.json',
  '.env.example',
  'nest-cli.json',
  'drizzle.config.ts',
  'vitest.config.ts',
  'vitest.config.e2e.ts',
  'README.md',
].map((name) => join(SERVER_ROOT, name));

const read = (path: string) => readFileSync(path, 'utf8');
const shown = (path: string) => relative(SERVER_ROOT, path);

describe('FR-17: no QA-issued tokens, no client secret (static)', () => {
  describe('the detectors', () => {
    it.each([
      'const token = sign(payload, key);',
      'return jwt.sign({ sub }, secret);',
      'await this.jwt.signAsync(claims);',
      'const signature = createSign("RSA-SHA256");',
      'const mac = createHmac("sha256", key);',
      'new SignJWT(claims).sign(key);',
      "import jwt from 'jsonwebtoken';",
      'import { SignJWT } from "jose";',
      'return signJwt(claims, key);',
    ])('flags signing in %j', (line) => {
      expect(findSigning(line)).not.toEqual([]);
    });

    it.each([
      '// jwt.sign(payload) is never called here',
      ' * createSign is out of scope',
      'const design = designer(layout);',
      'const signature = request.headers.signature;',
      'await this.verifier.verifyAccess(token);',
      "import { CognitoJwtVerifier } from 'aws-jwt-verify';",
    ])('does not flag %j', (line) => {
      expect(findSigning(line)).toEqual([]);
    });

    it.each([
      'COGNITO_CLIENT_SECRET=abc',
      'clientSecret: process.env.X',
      'const client_secret = "x";',
      '"cognito-client-secret": "x"',
    ])('flags a client secret in %j', (line) => {
      expect(hasClientSecret(line)).toBe(true);
    });

    it('does not flag a client secret that a comment only mentions', () => {
      expect(hasClientSecret('// there is no client secret')).toBe(false);
    });
  });

  describe('the tree', () => {
    it('scans the real source tree (a wrong path could pass vacuously)', () => {
      const scanned = sourceFiles().map((path) => relative(SRC_ROOT, path));
      expect(scanned.length).toBeGreaterThan(20);
      expect(scanned).toEqual(
        expect.arrayContaining([
          'main.ts',
          'auth/token-verifier.service.ts',
          'auth/guards/auth.guard.ts',
        ]),
      );
      expect(scanned.filter((path) => path.endsWith('.spec.ts'))).toEqual([]);
    });

    it('signs no token in server/src', () => {
      const found = sourceFiles().flatMap((path) =>
        findSigning(read(path)).map((match) => `${shown(path)}: ${match}`),
      );
      expect(found).toEqual([]);
    });

    it('holds no Cognito client secret in server/src or the server configuration', () => {
      const found = [...sourceFiles(), ...CONFIG_FILES]
        .filter((path) => hasClientSecret(read(path)))
        .map(shown);
      expect(found).toEqual([]);
    });

    it('depends on no signing library', () => {
      const manifest = JSON.parse(read(join(SERVER_ROOT, 'package.json'))) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const installed = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      });
      const signers = [
        'jsonwebtoken',
        'jose',
        'jws',
        'jwa',
        'njwt',
        'fast-jwt',
      ];
      expect(installed.filter((name) => signers.includes(name))).toEqual([]);
      expect(installed).not.toContain('@nestjs/jwt');
    });
  });
});
