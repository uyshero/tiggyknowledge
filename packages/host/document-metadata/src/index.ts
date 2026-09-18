import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {
  KnowledgeDocumentMetadata,
  KnowledgeDocumentWithMetadata,
  KnowledgeMetadataDocumentList,
  KnowledgeTag,
  KnowledgeTagList,
  RenameKnowledgeTagInput,
  SetKnowledgeDocumentFavoriteInput,
  SetKnowledgeDocumentTagsInput,
} from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/metadata-sqlite'
import { contributeSurface, HttpError, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeMetadata: DocumentMetadata
  }
}

function normalizeTagNames(input: string[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const value of input) {
    if (typeof value !== 'string') throw new RangeError('标签名称必须是文本')
    const name = value.trim()
    if (name.length === 0 || name.length > 32) throw new RangeError('标签名称长度应为 1 到 32 个字符')
    const key = name.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  if (names.length > 10) throw new RangeError('每个知识条目最多设置 10 个标签')
  return names
}

export class DocumentMetadata extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeMetadataStore']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeMetadata')
    contributeSurface(ctx, {
      clients: [
        {
          id: 'client-ui-tags',
          moduleName: '@tiggyknowledge/client-ui-tags',
          label: 'Tags',
          description: 'Tag browser and filtered documents',
        },
        {
          id: 'client-ui-favorites',
          moduleName: '@tiggyknowledge/client-ui-favorites',
          label: 'Favorites',
          description: 'Favorite documents workbench',
        },
      ],
      routes: [
        {
          id: 'metadata:get',
          methods: ['GET'],
          path: /^\/api\/documents\/([^/]+)\/metadata$/,
          handler: ({ json, match }) => {
            try {
              json(this.get(pathSegment(match)))
            } catch (error) {
              throw httpFromRange(error, 'document_not_found')
            }
          },
        },
        {
          id: 'metadata:set-tags',
          methods: ['PUT'],
          path: /^\/api\/documents\/([^/]+)\/tags$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            const input = await readJson<SetKnowledgeDocumentTagsInput>()
            try {
              json(this.setTags(pathSegment(match), Array.isArray(input.names) ? input.names : []))
            } catch (error) {
              throw httpFromRange(error, 'invalid_tags')
            }
          },
        },
        {
          id: 'metadata:set-favorite',
          methods: ['PUT'],
          path: /^\/api\/documents\/([^/]+)\/favorite$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            const input = await readJson<SetKnowledgeDocumentFavoriteInput>()
            if (typeof input.favorite !== 'boolean') throw new HttpError(400, 'invalid_favorite', '收藏状态必须是布尔值')
            try {
              json(this.setFavorite(pathSegment(match), input.favorite))
            } catch (error) {
              throw httpFromRange(error, 'document_not_found')
            }
          },
        },
        {
          id: 'metadata:tags',
          methods: ['GET'],
          path: '/api/tags',
          handler: ({ json }) => {
            const result: KnowledgeTagList = { items: this.listTags() }
            json(result)
          },
        },
        {
          id: 'metadata:rename-tag',
          methods: ['PUT'],
          path: /^\/api\/tags\/([^/]+)$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            const input = await readJson<RenameKnowledgeTagInput>()
            try {
              json(this.renameTag(pathSegment(match), input.name))
            } catch (error) {
              throw httpFromRange(error, 'invalid_tag')
            }
          },
        },
        {
          id: 'metadata:tag-documents',
          methods: ['GET'],
          path: /^\/api\/tags\/([^/]+)\/documents$/,
          handler: ({ json, match }) => {
            try {
              const result: KnowledgeMetadataDocumentList = { items: this.taggedDocuments(pathSegment(match)) }
              json(result)
            } catch (error) {
              throw httpFromRange(error, 'tag_not_found')
            }
          },
        },
        {
          id: 'metadata:favorites',
          methods: ['GET'],
          path: '/api/favorites',
          handler: ({ json }) => {
            const result: KnowledgeMetadataDocumentList = { items: this.favoriteDocuments() }
            json(result)
          },
        },
      ],
    })
  }

  get(documentId: string): KnowledgeDocumentMetadata {
    this.requireDocument(documentId)
    return this.ctx.knowledgeMetadataStore.metadata(documentId)
  }

  getMany(documentIds: string[]): Map<string, KnowledgeDocumentMetadata> {
    return this.ctx.knowledgeMetadataStore.metadataMany(documentIds)
  }

  normalizeTags(names: string[]): string[] {
    return normalizeTagNames(names)
  }

  setTags(documentId: string, names: string[]): KnowledgeDocumentMetadata {
    this.requireDocument(documentId)
    const result = this.ctx.knowledgeMetadataStore.setTags(documentId, this.normalizeTags(names))
    this.ctx.emit('knowledge/graph/invalidate')
    return result
  }

  setFavorite(documentId: string, favorite: boolean): KnowledgeDocumentMetadata {
    this.requireDocument(documentId)
    const result = this.ctx.knowledgeMetadataStore.setFavorite(documentId, favorite)
    this.ctx.emit('knowledge/graph/invalidate')
    return result
  }

  renameTag(tagId: string, name: string): KnowledgeTag {
    const result = this.ctx.knowledgeMetadataStore.renameTag(tagId, name)
    this.ctx.emit('knowledge/graph/invalidate')
    return result
  }

  listTags(): KnowledgeTag[] {
    return this.ctx.knowledgeMetadataStore.listTags()
  }

  taggedDocuments(tagId: string): KnowledgeDocumentWithMetadata[] {
    if (!this.listTags().some(tag => tag.id === tagId)) throw new RangeError('标签不存在')
    return this.enrich(this.ctx.knowledgeMetadataStore.taggedDocumentIds(tagId))
  }

  favoriteDocuments(): KnowledgeDocumentWithMetadata[] {
    return this.enrich(this.ctx.knowledgeMetadataStore.favoriteDocumentIds())
  }

  private enrich(ids: string[]): KnowledgeDocumentWithMetadata[] {
    const documents = new Map(this.ctx.knowledgeCatalog.getDocuments(ids).map(document => [document.id, document]))
    const libraries = new Map(this.ctx.knowledgeCatalog.listLibraries().map(library => [library.id, library.name]))
    const metadata = this.getMany(ids)
    return ids.flatMap(id => {
      const document = documents.get(id)
      if (document === undefined) return []
      return [{
        document,
        libraryName: libraries.get(document.libraryId) ?? '未知知识库',
        metadata: metadata.get(id) ?? { documentId: id, tags: [], isFavorite: false },
      }]
    })
  }

  private requireDocument(id: string): void {
    if (typeof id !== 'string' || id.length === 0 || this.ctx.knowledgeCatalog.getDocuments([id]).length === 0) {
      throw new RangeError('知识条目不存在')
    }
  }
}

export default DocumentMetadata
