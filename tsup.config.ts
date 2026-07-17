import {defineConfig} from 'tsup';

const baseConfig = {
  entry: {index: 'src/index.ts', testing: 'src/testing/index.ts'},
  target: 'node22',
  clean: true,
  bundle: true,
  minify: true,
  splitting: false,
  keepNames: true,
  outDir: 'dist',
  treeshake: true,
}

export default defineConfig([
  {
    ...baseConfig,
    format: ['esm'],
    dts: false,
    outExtension: () => ({js: '.mjs'})
  },
  {
    ...baseConfig,
    format: ['cjs'],
    dts: false,
    outExtension: () => ({js: '.cjs'})
  },
]);
