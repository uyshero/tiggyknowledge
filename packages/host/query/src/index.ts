import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type { KnowledgeQuery, KnowledgeSearchResponse } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/document-metadata'
import type {} from '@tiggyknowledge/index-fts'
import type {} from '@tiggyknowledge/semantic-capabilities'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeQuery: KnowledgeQueryService
  }
}

export class KnowledgeQueryService extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeIndex', 'knowledgeMetadata', 'knowledgeSemanticCapabilities']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeQuery')
  }

  search(input: KnowledgeQuery): KnowledgeSearchResponse {
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (text.length === 0 || text.length > 200) throw new RangeError('搜索内容长度应为 1 到 200 个字符')
    const mode = input.mode ?? 'auto'
    if ((mode === 'semantic' || mode === 'hybrid') && !this.ctx.knowledgeSemanticCapabilities.hasSemanticSearch()) {
      throw new RangeError(this.ctx.knowledgeSemanticCapabilities.snapshot().semantic.message)
    }
    const topK = input.topK ?? 20
    if (!Number.isInteger(topK) || topK < 1 || topK > 50) throw new RangeError('topK 应为 1 到 50 之间的整数')
    const libraryIds = Array.isArray(input.knowledgeBaseIds)
      ? [...new Set(input.knowledgeBaseIds.filter(id => typeof id === 'string' && id.length > 0))]
      : []
    const favoriteOnly = input.favoriteOnly === true
    const hits = this.ctx.knowledgeIndex.search({ text, libraryIds, limit: favoriteOnly ? 50 : topK })
    const documents = new Map(this.ctx.knowledgeCatalog.getDocuments(hits.map(hit => hit.documentId)).map(document => [document.id, document]))
    const metadata = this.ctx.knowledgeMetadata.getMany(hits.map(hit => hit.documentId))
    const results = hits.flatMap(hit => {
      const document = documents.get(hit.documentId)
      if (document === undefined) return []
      const documentMetadata = metadata.get(hit.documentId) ?? { documentId: hit.documentId, tags: [], isFavorite: false }
      if (favoriteOnly && !documentMetadata.isFavorite) return []
      return [{
        chunkId: hit.chunkId,
        knowledgeBaseId: hit.libraryId,
        documentId: hit.documentId,
        title: document.title,
        originalName: document.originalName,
        sourceType: document.sourceType,
        location: hit.location,
        snippet: hit.snippet,
        score: hit.score,
        tags: documentMetadata.tags,
        isFavorite: documentMetadata.isFavorite,
      }]
    }).slice(0, topK)
    return { query: text, mode: 'keyword', total: results.length, results }
  }
}

export default KnowledgeQueryService
