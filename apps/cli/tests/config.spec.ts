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
      'text-producer',
      'pdf-producer',
      'basic-chunker',
      'fts-index',
      'ingestion',
      'text-preview',
      'pdf-preview',
      'knowledge-documents',
      'document-metadata',
      'ingestion-tags',
      'note-creator',
      'knowledge-okf',
      'okf-export',
      'semantic-capabilities',
      'knowledge-query',
      'settings',
      'storage-manager',
      'client-bootstrap',
      'plugin-inventory',
      'webserver',
    ])
  })

  it('accepts repeatable patch arguments', () => {
    expect(parseArguments(['--patch', './one.yml', '--patch', './two.yml']).patches).toHaveLength(2)
  })

  it('rejects an incomplete patch argument', () => {
    expect(() => parseArguments(['--patch'])).toThrow('--patch requires a file path')
  })
})
