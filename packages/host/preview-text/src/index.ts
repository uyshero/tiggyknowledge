import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {} from '@tiggyknowledge/content-local'
import type { KnowledgeDocument, KnowledgeDocumentPreview, KnowledgeDocumentSourceType } from '@tiggyknowledge/contracts'
import { contributeSurface, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgePreview: TextPreview
  }
}

const MAX_PREVIEW_CHARACTERS = 200_000

export interface DocumentPreviewContent {
  content: string
  truncated: boolean
  pageCount?: number
  sourceUrl?: string
}

export type DocumentPreviewHandler = (document: KnowledgeDocument, bytes: Uint8Array) => DocumentPreviewContent | Promise<DocumentPreviewContent>

export class TextPreview extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeContent']

  private readonly handlers = new Map<KnowledgeDocumentSourceType, DocumentPreviewHandler>()

  constructor(ctx: Context) {
    super(ctx, 'knowledgePreview')
    const handler: DocumentPreviewHandler = (_document, bytes) => {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return {
        content: content.slice(0, MAX_PREVIEW_CHARACTERS),
        truncated: content.length > MAX_PREVIEW_CHARACTERS,
      }
    }
    this.register(['text', 'markdown'], handler)
    contributeSurface(ctx, {
      clients: [{
        id: 'client-preview-text',
        moduleName: '@tiggyknowledge/client-preview-text',
        label: 'Text Preview',
        description: 'Markdown and plain-text document preview',
      }],
      routes: [{
        id: 'preview:document',
        methods: ['GET'],
        path: /^\/api\/documents\/([^/]+)\/preview$/,
        handler: async ({ json, match }) => {
          try {
            json(await this.preview(pathSegment(match)))
          } catch (error) {
            throw httpFromRange(error, 'preview_unavailable')
          }
        },
      }],
    })
  }

  register(sourceTypes: KnowledgeDocumentSourceType[], handler: DocumentPreviewHandler): () => void {
    for (const sourceType of sourceTypes) {
      if (this.handlers.has(sourceType)) throw new Error(`preview: duplicate source type ${sourceType}`)
    }
    for (const sourceType of sourceTypes) this.handlers.set(sourceType, handler)
    return () => {
      for (const sourceType of sourceTypes) {
        if (this.handlers.get(sourceType) === handler) this.handlers.delete(sourceType)
      }
    }
  }

  async preview(documentId: string): Promise<KnowledgeDocumentPreview> {
    const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('知识条目不存在')
    const handler = this.handlers.get(document.sourceType)
    if (handler === undefined) throw new RangeError('当前没有可用的预览插件')
    const result = await handler(document, this.ctx.knowledgeContent.read(document.sourceAssetId))
    return {
      document,
      content: result.content,
      format: document.sourceType,
      truncated: result.truncated,
      ...(result.pageCount === undefined ? {} : { pageCount: result.pageCount }),
      ...(result.sourceUrl === undefined ? {} : { sourceUrl: result.sourceUrl }),
    }
  }
}

export default TextPreview
