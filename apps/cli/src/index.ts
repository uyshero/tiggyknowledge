#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@tiggyknowledge/webserver'
import { composeEntries, parseArguments } from './config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectRoot: string
    dataRoot: string
    webDistRoot: string
    webPort: number
  }
}

export const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export interface BootOptions {
  projectRoot?: string
  dataRoot?: string
  distRoot?: string
  port?: number
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
  const entries = composeEntries([
    { filename: bundle },
    { filename: profile, required: false },
    ...patchFiles.map(filename => ({ filename })),
  ])

  const ctx = new Context()
  const baseUrl = pathToFileURL(resolve(projectRoot, 'package.json')).href
  ctx.baseUrl = baseUrl
  ctx.provide('projectRoot', projectRoot)
  ctx.provide('dataRoot', dataRoot)
  ctx.provide('webDistRoot', distRoot)
  ctx.provide('webPort', port)
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
