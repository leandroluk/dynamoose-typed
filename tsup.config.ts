import {defineConfig} from 'tsup';

const baseConfig = {
  entry: ['src/index.ts'],
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
    dts: {compilerOptions: {ignoreDeprecations: '6.0', removeComments: false}},
    outExtension: () => ({js: '.mjs', dts: '.d.ts'})
  },
  {
    ...baseConfig,
    format: ['cjs'],
    dts: false,
    outExtension: () => ({js: '.cjs'})
  },
]);
