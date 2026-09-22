import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {} from '@tiggyknowledge/chunker-basic'
import type {} from '@tiggyknowledge/content-local'
import type { IngestionBatchResult, IngestionFileResult } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/index-fts'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/producer-text'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeIngestion: KnowledgeIngestion
  }
}

export interface IngestionFile {
  name: string
  bytes: Uint8Array
}

export class KnowledgeIngestion extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeContent', 'textProducer', 'knowledgeChunker', 'knowledgeIndex']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeIngestion')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-ui-ingestion',
        moduleName: '@tiggyknowledge/client-ui-ingestion',
        label: 'Ingestion',
        description: 'Batch upload workbench',
      }],
    })
  }

  async ingest(libraryId: string, files: IngestionFile[]): Promise<IngestionBatchResult> {
    const library = this.ctx.knowledgeCatalog.getLibrary(libraryId)
    if (library === undefined) throw new RangeError('知识库不存在')
    if (library.kind === 'studio') throw new RangeError('创作空间不能导入知识库文件')
    if (files.length === 0) throw new RangeError('至少选择一个文件')
    const jobId = this.ctx.knowledgeCatalog.createIngestionJob(libraryId, files.length)
    const results: IngestionFileResult[] = []
    for (const file of files) results.push(await this.ingestFile(libraryId, file))
    const result: IngestionBatchResult = {
      jobId,
      libraryId,
      totalFiles: results.length,
      importedFiles: results.filter(item => item.status === 'imported').length,
      duplicateFiles: results.filter(item => item.status === 'duplicate').length,
      failedFiles: results.filter(item => item.status === 'failed').length,
      results,
    }
    this.ctx.knowledgeCatalog.finishIngestionJob(result)
    this.ctx.emit('knowledge/graph/invalidate')
    return result
  }

  private async ingestFile(libraryId: string, file: IngestionFile): Promise<IngestionFileResult> {
    try {
      const produced = await this.ctx.textProducer.produce(file.name, file.bytes)
      const asset = this.ctx.knowledgeContent.save(file.bytes)
      const duplicate = this.ctx.knowledgeCatalog.findDocumentByHash(libraryId, asset.contentHash)
      if (duplicate !== undefined) {
        return { fileName: file.name, status: 'duplicate', document: duplicate, message: '该知识库中已存在相同内容' }
      }
      this.ctx.knowledgeCatalog.registerAsset(asset)
      let document = this.ctx.knowledgeCatalog.createDocument({
        libraryId,
        title: produced.title,
        originalName: file.name,
        sourceType: produced.sourceType,
        sourceAssetId: asset.id,
        contentHash: asset.contentHash,
        sizeBytes: asset.sizeBytes,
      })
      try {
        const chunks = this.ctx.knowledgeChunker.chunk({ body: produced.body, sourceType: produced.sourceType })
        this.ctx.knowledgeIndex.index({ id: document.id, libraryId, title: document.title }, chunks)
        document = this.ctx.knowledgeCatalog.setDocumentIndexStatus(document.id, 'ready')
        this.ctx.emit('knowledge/document/changed', [document.id])
        return { fileName: file.name, status: 'imported', document }
      } catch (error) {
        this.ctx.knowledgeCatalog.setDocumentIndexStatus(document.id, 'failed')
        throw error
      }
    } catch (error) {
      return {
        fileName: file.name,
        status: 'failed',
        message: error instanceof Error ? error.message : '导入失败',
      }
    }
  }
}

export default KnowledgeIngestion
