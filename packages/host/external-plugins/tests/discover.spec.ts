import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertNoBuiltinCollision,
  discoverExternalPlugins,
  externalPluginInsertPatch,
} from '../src/discover.ts'

function withPluginsDir(run: (dataRoot: string) => void): void {
  const dataRoot = mkdtempSync(join(tmpdir(), 'tiggyknowledge-plugins-'))
  try {
    run(dataRoot)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
}

describe('external plugin discovery', () => {
  it('returns nothing when the plugins directory is missing', () => {
    withPluginsDir(dataRoot => {
      expect(discoverExternalPlugins(dataRoot)).toEqual([])
    })
  })

  it('loads a plugin package and builds an insert patch', () => {
    withPluginsDir(dataRoot => {
      const directory = join(dataRoot, 'plugins', 'sample')
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'host.js'), 'export default {}\n')
      writeFileSync(join(directory, 'client.js'), 'export function apply() {}\n')
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: '@acme/tiggyknowledge-sample',
        type: 'module',
        main: './host.js',
        tiggyknowledgePlugin: {
          id: 'acme-sample',
          client: {
            moduleName: '@acme/tiggyknowledge-sample/client',
            entry: './client.js',
          },
        },
      }))

      const discovered = discoverExternalPlugins(dataRoot)
      expect(discovered).toMatchObject([{
        id: 'acme-sample',
        packageName: '@acme/tiggyknowledge-sample',
      }])
      expect(externalPluginInsertPatch(discovered)).toEqual([{
        insert: [{
          id: 'acme-sample',
          name: pathToFileURL(join(directory, 'host.js')).href,
        }],
      }])
    })
  })

  it('rejects a plugin id that collides with a builtin entry', () => {
    expect(() => assertNoBuiltinCollision([{
      id: 'webserver',
      packageName: '@acme/webserver',
      directory: '/tmp',
      hostEntry: '/tmp/index.js',
      config: {},
    }], new Set(['webserver']))).toThrow('collides with a builtin entry')
  })
})
