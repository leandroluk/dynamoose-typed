// TypeScript's declaration emitter resolves the `#`/`#/*` tsconfig path alias at compile time
// but does not rewrite it in the emitted .d.ts output — it copies the import specifier as
// written in the source. Consumers have no `#` mapping (it's not a package.json `imports`
// field, just a dev-time tsconfig path), so published declarations must use relative paths.
// This walks the emitted dist/**/*.d.ts files and rewrites `#`/`#/foo` specifiers to the
// correct relative path, computed from each file's own location.
import {readFileSync, writeFileSync} from 'node:fs';
import {glob} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const specifierPattern = /from ['"]#(\/[^'"]*)?['"]/g;

for await (const file of glob('**/*.d.ts', {cwd: distDir})) {
  const filePath = join(distDir, file);
  const source = readFileSync(filePath, 'utf8');

  const rewritten = source.replace(specifierPattern, (match, subpath) => {
    const targetPath = join(distDir, subpath ?? 'index');
    let relativePath = relative(dirname(filePath), targetPath).replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }
    return `from '${relativePath}'`;
  });

  if (rewritten !== source) {
    writeFileSync(filePath, rewritten);
  }
}
