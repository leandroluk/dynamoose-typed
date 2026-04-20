import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  target: 'node22',
  clean: true,
  bundle: true,
  minify: true,
  splitting: false,
  keepNames: true,
  outDir: 'dist',
  treeshake: true,
  dts: {compilerOptions: {ignoreDeprecations: '6.0'}},
  noExternal: ['dynamoose', 'aws-sdk', 'uuid'],
});
