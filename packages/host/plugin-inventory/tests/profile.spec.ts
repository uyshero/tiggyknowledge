import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { persistPluginEnabled, profilePatchPath, readProfilePatches, upsertDisabledPatch } from '../src/profile.ts'

describe('plugin inventory profile patches', () => {
  it('adds disabled patches for third-party ids and keeps other rows', () => {
    expect(upsertDisabledPatch([{ id: 'keep', config: { n: 1 } }], 'acme-sample', false)).toEqual([
      { id: 'keep', config: { n: 1 } },
      { id: 'acme-sample', disabled: true },
    ])
    expect(upsertDisabledPatch([{ id: 'acme-sample', disabled: true }], 'acme-sample', true)).toEqual([
      { id: 'acme-sample', disabled: false },
    ])
    expect(upsertDisabledPatch([], 'acme-sample', true)).toEqual([])
  })

  it('writes and restores the local profile file', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'tiggyknowledge-plugin-profile-'))
    try {
      persistPluginEnabled(dataRoot, 'acme-sample', false)
      const filename = profilePatchPath(dataRoot)
      expect(readProfilePatches(filename)).toEqual([{ id: 'acme-sample', disabled: true }])
      const revert = persistPluginEnabled(dataRoot, 'acme-sample', true)
      expect(readProfilePatches(filename)).toEqual([{ id: 'acme-sample', disabled: false }])
      revert()
      expect(readFileSync(filename, 'utf8')).toContain('disabled: true')
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })
})
