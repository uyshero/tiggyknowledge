import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type { KnowledgeOkfMapping } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/document-metadata'
import type {} from '@tiggyknowledge/preview-text'
import { contributeSurface, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeOkf: KnowledgeOkf
  }
}

export class KnowledgeOkf extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeMetadata', 'knowledgePreview']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeOkf')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-inspector-okf',
        moduleName: '@tiggyknowledge/client-inspector-okf',
        label: 'OKF Inspector',
        description: 'Runtime OKF concept and source mapping',
      }],
      routes: [{
        id: 'okf:mapping',
        methods: ['GET'],
        path: /^\/api\/documents\/([^/]+)\/okf$/,
        handler: async ({ json, match }) => {
          try {
            json(await this.mapping(pathSegment(match)))
          } catch (error) {
            throw httpFromRange(error, 'document_not_found')
          }
        },
      }],
    })
  }

  async mapping(documentId: string): Promise<KnowledgeOkfMapping> {
    const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('知识条目不存在')
    const metadata = this.ctx.knowledgeMetadata.get(documentId)
    const preview = await this.ctx.knowledgePreview.preview(documentId)
    const description = `由 ${document.originalName} 导入的知识条目`
    return {
      documentId,
      concept: {
        id: document.id,
        type: 'Concept',
        path: `${document.id}.md`,
        title: document.title,
        description,
        tags: metadata.tags,
        body: preview.content,
        generatedBy: `process:knowledge-import/${document.sourceType}`,
        generatedAt: document.createdAt,
        sources: [{
          id: document.sourceAssetId,
          resource: `knowledge-asset://${document.sourceAssetId}`,
          title: document.originalName,
          contentHash: document.contentHash,
          sizeBytes: document.sizeBytes,
        }],
      },
      storage: {
        bundleState: 'runtime-mapped',
        originalAssetId: document.sourceAssetId,
        indexStatus: document.indexStatus,
      },
      validation: {
        status: 'not-run',
        message: '当前文档仅展示运行时 OKF 映射；导出知识库时，独立的 OKF 导出插件会物化 Bundle 并执行 v0.2 一致性校验。',
      },
    }
  }
}

export default KnowledgeOkf
