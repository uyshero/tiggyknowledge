import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/document-metadata'
import type { IngestionFile } from '@tiggyknowledge/ingestion'
import type { IngestionBatchResult } from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeTaggedIngestion: TaggedIngestion
  }
}

export class TaggedIngestion extends Service {
  static inject = ['knowledgeIngestion', 'knowledgeMetadata']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeTaggedIngestion')
  }

  async ingest(libraryId: string, files: IngestionFile[], tagNames: string[]): Promise<IngestionBatchResult> {
    const tags = this.ctx.knowledgeMetadata.normalizeTags(tagNames)
    const result = await this.ctx.knowledgeIngestion.ingest(libraryId, files)
    if (tags.length === 0) return result
    for (const item of result.results) {
      if (item.status === 'imported' && item.document !== undefined) {
        this.ctx.knowledgeMetadata.setTags(item.document.id, tags)
      }
    }
    this.ctx.emit('knowledge/graph/invalidate')
    return result
  }
}

export default TaggedIngestion
