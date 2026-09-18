import { Context, Service } from '@deepseek-ai/cordis'
import type { KnowledgeDocument, KnowledgeDocumentSourceType } from '@tiggyknowledge/contracts'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/catalog-sqlite'

export interface DuplicateDocument {
  id: string
  libraryId: string
  libraryName: string
  title: string
  originalName: string
  sourceType: KnowledgeDocumentSourceType
  updatedAt: string
}

export interface DuplicateGroup {
  contentHash: string
  sizeBytes: number
  documents: DuplicateDocument[]
}

export interface DuplicateGroupsSnapshot {
  groups: DuplicateGroup[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    exampleDuplicates: ExampleDuplicates
  }
}

export class ExampleDuplicates extends Service {
  static inject = ['knowledgeCatalog']

  constructor(ctx: Context) {
    super(ctx, 'exampleDuplicates')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-example-duplicates',
        moduleName: '@example/tiggyknowledge-duplicates/client',
        label: 'Duplicate documents',
        description: 'Find catalog entries that share a content hash',
        url: '/ext/plugins/example-duplicates/client.js',
      }],
      snapshot: {
        id: 'example-duplicates',
        contribute: () => ({ exampleDuplicates: { groupCount: this.groups().length } }),
      },
      routes: [{
        id: 'example-duplicates:groups',
        methods: ['GET'],
        path: '/api/ext/example-duplicates/groups',
        handler: ({ json, url }) => {
          const libraryId = url.searchParams.get('libraryId')
          json({ groups: this.groups(libraryId === null || libraryId.length === 0 ? undefined : libraryId) })
        },
      }],
    })
  }

  groups(libraryId?: string): DuplicateGroup[] {
    const libraries = this.ctx.knowledgeCatalog.listLibraries()
      .filter(library => libraryId === undefined || library.id === libraryId)
    const names = new Map(libraries.map(library => [library.id, library.name]))
    const documents = libraries.flatMap(library => this.ctx.knowledgeCatalog.listDocuments(library.id))
    const grouped = new Map<string, KnowledgeDocument[]>()
    for (const document of documents) {
      if (document.contentHash.length === 0) continue
      const bucket = grouped.get(document.contentHash) ?? []
      bucket.push(document)
      grouped.set(document.contentHash, bucket)
    }
    return [...grouped.values()]
      .filter(items => items.length > 1)
      .map(items => ({
        contentHash: items[0]!.contentHash,
        sizeBytes: items[0]!.sizeBytes,
        documents: items
          .map(document => ({
            id: document.id,
            libraryId: document.libraryId,
            libraryName: names.get(document.libraryId) ?? document.libraryId,
            title: document.title,
            originalName: document.originalName,
            sourceType: document.sourceType,
            updatedAt: document.updatedAt,
          }))
          .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN')),
      }))
      .sort((left, right) => right.documents.length - left.documents.length || left.contentHash.localeCompare(right.contentHash))
  }
}

export default ExampleDuplicates
