import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const repo = fileURLToPath(new URL('../..', import.meta.url))
const outdir = resolve(process.argv[2] ?? resolve(root, 'dist'))

mkdirSync(outdir, { recursive: true })

const nodePaths = [resolve(repo, 'node_modules')]

await esbuild.build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: [resolve(root, 'host/src/index.ts')],
  external: ['@deepseek-ai/*', '@tiggyknowledge/*'],
  format: 'esm',
  outfile: resolve(outdir, 'host.js'),
  platform: 'node',
  target: 'es2024',
  nodePaths,
})

await esbuild.build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: [resolve(root, 'client/src/index.tsx')],
  external: [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    '@deepseek-ai/cordis',
    '@tiggyknowledge/client-runtime',
    '@tiggyknowledge/client-connection',
  ],
  format: 'esm',
  jsx: 'automatic',
  outfile: resolve(outdir, 'client.js'),
  platform: 'browser',
  target: 'es2024',
  nodePaths,
})

process.stdout.write(`built ${dirname(resolve(outdir, 'host.js'))}\n`)
