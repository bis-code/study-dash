#!/usr/bin/env node
import { rollup } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import { string } from 'rollup-plugin-string';

const bundle = await rollup({
  input: 'src/index.ts',
  external: ['better-sqlite3'],
  plugins: [
    string({ include: ['**/*.html', '**/*.css', '**/dashboard/static/*.js'] }),
    json(),
    resolve({ preferBuiltins: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json' }),
  ],
});

await bundle.write({
  file: 'dist/bundle.mjs',
  format: 'esm',
  inlineDynamicImports: true,
});

await bundle.close();
console.log('Bundle written to dist/bundle.mjs');
