import { defineConfig } from 'tsdown'

export default defineConfig({
  workspace: [
    'vendor/*',
    'packages/core/*',
    'packages/storage/*',
    'packages/settings/*',
    'packages/host/*',
    'apps/cli',
  ],
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
