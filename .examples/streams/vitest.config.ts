import {resolve} from 'path';
import swc from 'unplugin-swc';
import {defineConfig} from 'vitest/config';

// Reuses the same SWC decorator transform as the project's own vitest.config.ts (legacy
// `experimentalDecorators`, matching tsconfig.json) — required because `@DynamoTable` /
// `@StringAttribute` are legacy-style decorators, not TC39 stage-3 ones.
export default defineConfig({
  root: __dirname,
  plugins: [
    swc.vite({
      jsc: {
        parser: {syntax: 'typescript', decorators: true},
        transform: {decoratorVersion: '2021-12'},
        target: 'es2022',
      },
    }),
  ],
  test: {
    globals: false,
    environment: 'node',
    include: ['*.smoke.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {'#': resolve(__dirname, '../../src')},
  },
});
