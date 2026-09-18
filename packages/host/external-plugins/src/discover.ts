import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { ExternalPluginRecord } from '@tiggyknowledge/contracts'

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/

interface PluginManifest {
  id?: unknown
  host?: unknown
  config?: unknown
  client?: unknown
}

interface PackageManifest {
  name?: unknown
  main?: unknown
  tiggyknowledgePlugin?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readJson(filename: string): unknown {
  try {
    return JSON.parse(readFileSync(filename, 'utf8'))
  } catch (error) {
    throw new Error(`external-plugins: failed to parse ${filename}: ${String(error)}`, { cause: error })
  }
}

function resolveInside(directory: string, candidate: string, label: string): string {
  const resolved = resolve(directory, candidate)
  const relativePath = relative(directory, resolved)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`external-plugins: ${label} must stay inside the plugin directory`)
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`external-plugins: ${label} not found: ${resolved}`)
  }
  return resolved
}

function parsePlugin(directory: string): ExternalPluginRecord {
  const filename = resolve(directory, 'package.json')
  const manifest = readJson(filename) as PackageManifest
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error(`external-plugins: ${filename} is missing name`)
  }
  if (manifest.name.startsWith('@tiggyknowledge/')) {
    throw new Error(`external-plugins: ${manifest.name} must not use the @tiggyknowledge scope`)
  }
  const field = asRecord(manifest.tiggyknowledgePlugin) as PluginManifest | undefined
  if (field === undefined) {
    throw new Error(`external-plugins: ${filename} is missing tiggyknowledgePlugin`)
  }
  if (typeof field.id !== 'string' || !PLUGIN_ID.test(field.id)) {
    throw new Error(`external-plugins: ${filename} has an invalid tiggyknowledgePlugin.id`)
  }
  const hostPath = typeof field.host === 'string' && field.host.length > 0
    ? field.host
    : typeof manifest.main === 'string' && manifest.main.length > 0
      ? manifest.main
      : undefined
  if (hostPath === undefined) {
    throw new Error(`external-plugins: ${filename} needs tiggyknowledgePlugin.host or main`)
  }
  const config = field.config === undefined ? {} : asRecord(field.config)
  if (config === undefined) {
    throw new Error(`external-plugins: ${filename} tiggyknowledgePlugin.config must be an object`)
  }

  const record: ExternalPluginRecord = {
    id: field.id,
    packageName: manifest.name,
    directory,
    hostEntry: resolveInside(directory, hostPath, 'host entry'),
    config,
  }

  if (field.client === undefined) return record
  const client = asRecord(field.client)
  if (client === undefined) {
    throw new Error(`external-plugins: ${filename} tiggyknowledgePlugin.client must be an object`)
  }
  if (typeof client.moduleName !== 'string' || client.moduleName.length === 0) {
    throw new Error(`external-plugins: ${filename} tiggyknowledgePlugin.client.moduleName is required`)
  }
  if (typeof client.entry !== 'string' || client.entry.length === 0) {
    throw new Error(`external-plugins: ${filename} tiggyknowledgePlugin.client.entry is required`)
  }
  record.clientFile = resolveInside(directory, client.entry, 'client entry')
  return record
}

export function pluginsRoot(dataRoot: string): string {
  return resolve(dataRoot, 'plugins')
}

export function discoverExternalPlugins(dataRoot: string): ExternalPluginRecord[] {
  const root = pluginsRoot(dataRoot)
  if (!existsSync(root) || !statSync(root).isDirectory()) return []
  const records: ExternalPluginRecord[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const directory = resolve(root, entry.name)
    if (!existsSync(resolve(directory, 'package.json'))) continue
    const record = parsePlugin(directory)
    if (ids.has(record.id)) throw new Error(`external-plugins: duplicate plugin id ${record.id}`)
    if (names.has(record.packageName)) throw new Error(`external-plugins: duplicate package ${record.packageName}`)
    ids.add(record.id)
    names.add(record.packageName)
    records.push(record)
  }
  return records.sort((left, right) => left.id.localeCompare(right.id))
}

export function externalPluginInsertPatch(plugins: ExternalPluginRecord[]): PatchOptions[] {
  if (plugins.length === 0) return []
  return [{
    insert: plugins.map(plugin => ({
      id: plugin.id,
      name: pathToFileURL(plugin.hostEntry).href,
      ...(Object.keys(plugin.config).length > 0 ? { config: structuredClone(plugin.config) } : {}),
    })),
  }]
}

export function assertNoBuiltinCollision(plugins: ExternalPluginRecord[], builtinIds: ReadonlySet<string>): void {
  for (const plugin of plugins) {
    if (builtinIds.has(plugin.id)) {
      throw new Error(`external-plugins: plugin id ${plugin.id} collides with a builtin entry`)
    }
  }
}

export function isPathInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root)
  const resolved = resolve(candidate)
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + sep)
}
