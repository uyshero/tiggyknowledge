import { describe, expect, it } from 'vitest'
import { createCapabilitiesSnapshot, createKnowledgeSourceReference } from '../src/index.ts'

describe('TiggyKnowledge capability discovery', () => {
  it('describes the read-only agent API and active search modes', () => {
    const snapshot = createCapabilitiesSnapshot(
      ['keyword', 'semantic', 'keyword'],
      [{
        entryId: 'plugin-1',
        moduleName: '@tiggyknowledge/query',
        face: 'host',
        origin: 'builtin',
        disableable: false,
        enabled: true,
        phase: 'active',
      }],
      '0.2.3',
    )

    expect(snapshot).toEqual({
      product: 'tiggyknowledge',
      version: '0.2.3',
      capabilities: {
        protocolVersion: 1,
        basePath: '/api/tiggyknowledge',
        authentication: 'bearer',
        operations: [
          { id: 'status', method: 'GET', path: '/api/tiggyknowledge/status', readOnly: true },
          { id: 'libraries', method: 'GET', path: '/api/tiggyknowledge/libraries', readOnly: true },
          { id: 'search', method: 'POST', path: '/api/tiggyknowledge/search', readOnly: true },
          { id: 'read', method: 'GET', path: '/api/tiggyknowledge/documents/:id/read', readOnly: true },
          { id: 'okf', method: 'GET', path: '/api/tiggyknowledge/documents/:id/okf', readOnly: true },
        ],
        searchModes: ['keyword', 'semantic'],
        referenceSchemes: ['tk://local'],
        write: false,
      },
      hostPlugins: [{
        entryId: 'plugin-1',
        moduleName: '@tiggyknowledge/query',
        face: 'host',
        origin: 'builtin',
        disableable: false,
        enabled: true,
        phase: 'active',
      }],
    })
  })

  it('does not advertise write operations', () => {
    const snapshot = createCapabilitiesSnapshot(['keyword'], [], '0.2.3')

    expect(snapshot.capabilities.write).toBe(false)
    expect(snapshot.capabilities.operations.every(operation => operation.readOnly)).toBe(true)
    expect(snapshot.capabilities.operations.map(operation => operation.id)).not.toContain('write')
  })

  it('omits the OKF operation when the plugin is not loaded', () => {
    const snapshot = createCapabilitiesSnapshot(['keyword'], [], '0.2.3', false)

    expect(snapshot.capabilities.operations.map(operation => operation.id)).toEqual([
      'status',
      'libraries',
      'search',
      'read',
    ])
  })

  it('creates a stable encoded local citation without endpoint details', () => {
    expect(createKnowledgeSourceReference({
      id: 'document/一',
      libraryId: 'library one',
      title: '引用测试',
      sourceType: 'markdown',
    })).toEqual({
      uri: 'tk://local/library%20one/document%2F%E4%B8%80',
      knowledgeBaseId: 'library one',
      documentId: 'document/一',
      title: '引用测试',
      sourceType: 'markdown',
    })
  })
})
