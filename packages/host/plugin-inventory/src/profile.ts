import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { dump, load } from 'js-yaml'
import { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'

export function profilePatchPath(dataRoot: string): string {
  return resolve(dataRoot, 'profiles/local/cordis.patch.yml')
}

export function readProfilePatches(filename: string): PatchOptions[] {
  if (!existsSync(filename)) return []
  const parsed: unknown = load(readFileSync(filename, 'utf8'), { schema: entryListSchema })
  if (parsed === undefined || parsed === null) return []
  if (!Array.isArray(parsed)) throw new RangeError('profile 必须是 YAML 数组')
  return parsed as PatchOptions[]
}

export function upsertDisabledPatch(patches: PatchOptions[], id: string, enabled: boolean): PatchOptions[] {
  const next = structuredClone(patches)
  const index = next.findIndex(patch => patch.id === id && patch.insert === undefined)
  if (index < 0) {
    if (enabled) return next
    next.push({ id, disabled: true })
    return next
  }
  next[index]!.disabled = !enabled
  return next
}

export function writeProfilePatches(filename: string, patches: PatchOptions[]): void {
  mkdirSync(dirname(filename), { recursive: true })
  const content = dump(patches, { lineWidth: -1, noRefs: true, schema: entryListSchema })
  const temporary = `${filename}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, filename)
}

export function persistPluginEnabled(dataRoot: string, id: string, enabled: boolean): () => void {
  const filename = profilePatchPath(dataRoot)
  const previous = existsSync(filename) ? readFileSync(filename, 'utf8') : undefined
  const next = upsertDisabledPatch(readProfilePatches(filename), id, enabled)
  if (previous === undefined && next.length === 0) return () => undefined
  writeProfilePatches(filename, next)
  return () => {
    if (previous === undefined) {
      if (existsSync(filename)) unlinkSync(filename)
      return
    }
    writeFileSync(filename, previous)
  }
}
