// TypeScript's declaration emitter resolves the `#`/`#/*` tsconfig path alias at compile time
// but does not rewrite it in the emitted .d.ts output — it copies the import specifier as
// written in the source. Consumers have no `#` mapping (it's not a package.json `imports`
// field, just a dev-time tsconfig path), so published declarations must use relative paths.
// This walks the emitted dist/**/*.d.ts files and:
//   1. Rewrites `#`/`#/foo` specifiers to the correct relative path, computed from each
//      file's own location.
//   2. Adds `.js` / `/index.js` extensions to all local relative imports, so consumers
//      with `moduleResolution: "NodeNext"` can resolve them without errors.
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {glob} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const hashAliasPattern = /from ['"]#(\/[^'"]*)?['"]/g;
const relativeSpecifierPattern = /from\s+'((\.\.?\/)(?:[^'/]+\/)*[^'/]+)'/g;

for await (const file of glob('**/*.d.ts', {cwd: distDir})) {
  const filePath = join(distDir, file);
  let source = readFileSync(filePath, 'utf8');
  const original = source;

  // — pass 1: rewrite #/ path aliases to relative paths —
  source = source.replace(hashAliasPattern, (match, subpath) => {
    const targetPath = join(distDir, subpath ?? 'index');
    let relativePath = relative(dirname(filePath), targetPath).replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }
    return `from '${relativePath}'`;
  });

  // — pass 2: add .js / /index.js to local relative imports —
  // spec is relative to the .d.ts file, so resolve against its directory
  source = source.replace(relativeSpecifierPattern, (match, spec) => {
    const base = dirname(filePath);
    const asFile = join(base, `${spec}.d.ts`);
    const asIndex = join(base, `${spec}/index.d.ts`);
    if (existsSync(asFile)) {
      return `from '${spec}.js'`;
    }
    if (existsSync(asIndex)) {
      return `from '${spec}/index.js'`;
    }
    return match;
  });

  if (source !== original) {
    writeFileSync(filePath, source);
  }
}
