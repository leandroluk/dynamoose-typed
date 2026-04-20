import {resolve} from 'path';
import swc from 'unplugin-swc';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  oxc: false,
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
    include: ['test/**/*.{test,spec}.{ts,mts,cts,tsx}'],
    coverage: {
      reportsDirectory: '.coverage',
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['node_modules', 'dist', 'test', '**/index.ts', '**/*.types.ts', 'testing/**'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
    alias: {'#': resolve(__dirname, './src')},
  },
});
