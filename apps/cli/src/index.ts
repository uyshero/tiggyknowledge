#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@tiggyknowledge/webserver'
import type { SecretCodec } from '@tiggyknowledge/llm-credentials'
import {
  assertNoBuiltinCollision,
  discoverExternalPlugins,
  externalPluginInsertPatch,
} from '@tiggyknowledge/external-plugins'
import { bundleEntryIds, composeEntries, parseArguments } from './config.ts'
import { setExternalPluginResolveContext } from './plugin-resolve.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectRoot: string
    dataRoot: string
    webDistRoot: string
    webPort: number
    appVersion: string
    secretCodec: SecretCodec | undefined
  }
}

export const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export interface BootOptions {
  projectRoot?: string
  dataRoot?: string
  distRoot?: string
  port?: number
  secretCodec?: SecretCodec
}

function readProjectVersion(projectRoot: string): string {
  const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('tiggyknowledge: project package.json has no version')
  }
  return manifest.version
}

function formatError(error: unknown, indent = ''): string {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map(item => formatError(item, `${indent}  `))]
      .map((line, index) => index === 0 ? `${indent}${line}` : line)
      .join('\n')
  }
  return `${indent}${error instanceof Error ? error.message : String(error)}`
}

export async function boot(patchFiles: string[] = [], options: BootOptions = {}): Promise<Context> {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT)
  const dataRoot = resolve(options.dataRoot ?? resolve(projectRoot, 'app-data'))
  const distRoot = resolve(options.distRoot ?? resolve(projectRoot, 'apps/web/dist'))
  const port = options.port ?? Number(process.env.TIGGYKNOWLEDGE_PORT ?? 3210)
  const bundle = resolve(projectRoot, 'packages/bundle/local/cordis.patch.yml')
  const profile = resolve(dataRoot, 'profiles/local/cordis.patch.yml')
  const builtinIds = bundleEntryIds(bundle)
  const discovered = discoverExternalPlugins(dataRoot)
  assertNoBuiltinCollision(discovered, builtinIds)
  await setExternalPluginResolveContext(
    resolve(projectRoot, 'apps/cli/package.json'),
    discovered.map(plugin => plugin.directory),
  )
  const entries = composeEntries([
    { filename: bundle },
    { patches: externalPluginInsertPatch(discovered) },
    { filename: profile, required: false },
    ...patchFiles.map(filename => ({ filename })),
  ])

  const ctx = new Context()
  const baseUrl = pathToFileURL(resolve(projectRoot, 'apps/cli/package.json')).href
  ctx.baseUrl = baseUrl
  ctx.provide('projectRoot', projectRoot)
  ctx.provide('dataRoot', dataRoot)
  ctx.provide('webDistRoot', distRoot)
  ctx.provide('webPort', port)
  ctx.provide('appVersion', readProjectVersion(projectRoot))
  ctx.provide('builtinPluginIds', builtinIds)
  ctx.provide('externalPluginRegistry', discovered)
  if (options.secretCodec !== undefined) ctx.provide('secretCodec', options.secretCodec)
  try {
    await ctx.plugin(Loader, { baseUrl })
    await ctx.loader.root.update(entries)
    await ctx.loader.await()
    const failures = [...ctx.loader.entries()].filter(entry => {
      if (entry.disabled) return false
      return entry.fiber === undefined || entry.fiber.state !== FiberState.ACTIVE
    })
    if (failures.length > 0) {
      throw new Error(`inactive plugins: ${failures.map(entry => entry.options.name).join(', ')}`)
    }
    return ctx
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write('Usage: tiggyknowledge [--patch <cordis.patch.yml>]\n')
    return
  }
  const ctx = await boot(options.patches)
  process.stdout.write(`tiggyknowledge: ${ctx.webServer.url}\n`)
  let stopping = false
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return
    stopping = true
    void ctx.fiber.dispose().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${formatError(error)}\n`)
    process.exitCode = 1
  })
}
