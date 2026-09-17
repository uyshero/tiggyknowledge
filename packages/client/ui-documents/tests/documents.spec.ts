import { describe, expect, it } from 'vitest'
import { selectedDocumentRoute, shouldPublishDocumentRoute } from '../src/index.tsx'

describe('documents route synchronization', () => {
  it('does not overwrite a fresh external navigation with stale local state', () => {
    const external = { libraryId: 'library-b', documentId: 'document-b', location: '第 2 段' }
    const staleLocal = { libraryId: 'library-a', documentId: 'document-a' }
    expect(shouldPublishDocumentRoute(true, external, staleLocal)).toBe(false)
  })

  it('publishes user-driven library and document changes to overlays', () => {
    expect(selectedDocumentRoute('library-b', 'document-b')).toEqual({
      libraryId: 'library-b',
      documentId: 'document-b',
    })
    expect(selectedDocumentRoute('library-b')).toEqual({ libraryId: 'library-b' })
    expect(shouldPublishDocumentRoute(
      false,
      { libraryId: 'library-a', documentId: 'document-a' },
      { libraryId: 'library-b', documentId: 'document-b' },
    )).toBe(true)
    expect(shouldPublishDocumentRoute(
      false,
      { libraryId: 'library-b', documentId: 'document-b' },
      { libraryId: 'library-b', documentId: 'document-b' },
    )).toBe(false)
  })
})
