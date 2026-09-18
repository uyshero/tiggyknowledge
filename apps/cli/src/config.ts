import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import {
  applyEntryPatches,
  entryListSchema,
  type PatchOptions,
} from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

export interface ParsedArguments {
  patches: string[]
  help: boolean
}

export interface ComposeSource {
  filename?: string
  required?: boolean
  patches?: PatchOptions[]
}

export function parseArguments(args: string[]): ParsedArguments {
  const patches: string[] = []
  let help = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--patch') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error('tiggyknowledge: --patch requires a file path')
      patches.push(resolve(value))
      index += 1
      continue
    }
    throw new Error(`tiggyknowledge: unknown argument ${String(arg)}`)
  }
  return { patches, help }
}

export function loadPatchFile(filename: string, required = true): PatchOptions[] {
  if (!existsSync(filename)) {
    if (!required) return []
    throw new Error(`tiggyknowledge: patch file not found: ${filename}`)
  }
  let parsed: unknown
  try {
    parsed = load(readFileSync(filename, 'utf8'), { schema: entryListSchema })
  } catch (error) {
    throw new Error(`tiggyknowledge: failed to parse ${filename}: ${String(error)}`, { cause: error })
  }
  if (!Array.isArray(parsed)) throw new Error(`tiggyknowledge: ${filename} must contain a top-level YAML array`)
  return parsed as PatchOptions[]
}

export function composeEntries(sources: ComposeSource[]): EntryOptions[] {
  const patches = sources.flatMap(source => {
    if (source.patches !== undefined) return source.patches
    if (source.filename === undefined) return []
    return loadPatchFile(source.filename, source.required ?? true)
  })
  return applyEntryPatches([], structuredClone(patches), (message, ...args) => {
    let offset = 0
    const detail = message.replace(/%C/g, () => JSON.stringify(args[offset++]))
    process.stderr.write(`tiggyknowledge: ${detail}\n`)
  })
}

export function bundleEntryIds(bundle: string): Set<string> {
  return new Set(composeEntries([{ filename: bundle }]).map(entry => entry.id))
}
