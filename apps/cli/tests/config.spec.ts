import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeEntries, parseArguments } from '../src/config.ts'

const ROOT = resolve(import.meta.dirname, '../../..')

describe('local Cordis composition', () => {
  it('builds the shipped host plugin tree from the bundle patch', () => {
    const entries = composeEntries([{
      filename: resolve(ROOT, 'packages/bundle/local/cordis.patch.yml'),
    }])
    expect(entries.map(entry => entry.id)).toEqual([
      'logger-console',
      'knowledge-catalog',
      'knowledge-content',
      'knowledge-metadata-store',
      'chat-storage',
      'text-producer',
      'pdf-producer',
      'url-producer',
      'basic-chunker',
      'fts-index',
      'ingestion',
      'text-preview',
      'pdf-preview',
      'url-preview',
      'audio-preview',
      'knowledge-documents',
      'document-metadata',
      'knowledge-graph',
      'ingestion-tags',
      'note-creator',
      'url-creator',
      'knowledge-okf',
      'okf-export',
      'semantic-capabilities',
      'http-router',
      'wiki-store',
      'knowledge-query',
      'settings',
      'llm-credentials',
      'llm-client',
      'studio',
      'llm-wiki',
      'llm-api',
      'mineru-api',
      'library-chat',
      'wiki-governance',
      'storage-manager',
      'client-bootstrap',
      'plugin-inventory',
      'external-plugins',
      'agent-api',
      'webserver',
    ])
  })

  it('accepts repeatable patch arguments', () => {
    expect(parseArguments(['--patch', './one.yml', '--patch', './two.yml']).patches).toHaveLength(2)
  })

  it('can disable wiki, chat and OKF without dropping the kernel plugins', () => {
    const entries = composeEntries([
      { filename: resolve(ROOT, 'packages/bundle/local/cordis.patch.yml') },
      { filename: resolve(import.meta.dirname, 'fixtures/disable-wiki-chat-okf.patch.yml') },
    ])
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    expect(byId.get('knowledge-okf')?.disabled).toBe(true)
    expect(byId.get('okf-export')?.disabled).toBe(true)
    expect(byId.get('llm-wiki')?.disabled).toBe(true)
    expect(byId.get('wiki-governance')?.disabled).toBe(true)
    expect(byId.get('library-chat')?.disabled).toBe(true)
    expect(byId.get('llm-api')?.disabled).toBeFalsy()
    expect(byId.get('agent-api')?.disabled).toBeFalsy()
    expect(byId.get('webserver')?.disabled).toBeFalsy()
    expect(byId.has('library-chat-api')).toBe(false)
    expect(byId.has('wiki-governance-api')).toBe(false)
  })

  it('inserts discovered third-party plugins and lets a later patch disable them', () => {
    const bundle = resolve(ROOT, 'packages/bundle/local/cordis.patch.yml')
    const entries = composeEntries([
      { filename: bundle },
      {
        patches: [{
          insert: [{
            id: 'example-duplicates',
            name: 'file:///tmp/example-duplicates/host.js',
          }],
        }],
      },
      {
        patches: [{
          id: 'example-duplicates',
          disabled: true,
        }],
      },
    ])
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    expect(byId.get('example-duplicates')).toMatchObject({
      name: 'file:///tmp/example-duplicates/host.js',
      disabled: true,
    })
    expect(byId.get('webserver')?.disabled).toBeFalsy()
  })

  it('rejects an incomplete patch argument', () => {
    expect(() => parseArguments(['--patch'])).toThrow('--patch requires a file path')
  })
})
