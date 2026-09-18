import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/index-fts'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/preview-text'
import { parseShortcutUrl } from '@tiggyknowledge/producer-url'

declare module '@deepseek-ai/cordis' {
  interface Context {
    urlPreview: UrlPreview
  }
}

function indexedPageText(ctx: Context, documentId: string): string {
  return ctx.knowledgeIndex.listDocumentChunks(documentId).map(chunk => chunk.body).join('\n\n').trim()
}

function liveTextLooksThin(text: string, url: string): boolean {
  const cleaned = text.trim()
  return cleaned.length === 0 || cleaned === url || cleaned.length < 80
}

export class UrlPreview extends Service {
  static inject = ['knowledgePreview', 'urlProducer', 'knowledgeIndex']

  constructor(ctx: Context) {
    super(ctx, 'urlPreview')
    ctx.effect(() => ctx.knowledgePreview.register(['url'], async (document, bytes) => {
      const url = parseShortcutUrl(document.originalName, bytes)
      const indexed = indexedPageText(ctx, document.id)
      try {
        const page = await ctx.urlProducer.fetch(url)
        const live = page.text.trim()
        const content = liveTextLooksThin(live, page.url) && indexed.length > live.length ? indexed : (live.length === 0 ? url : live)
        return {
          content,
          truncated: page.truncated,
          sourceUrl: page.url,
        }
      } catch (error) {
        return {
          content: indexed.length > 0 ? indexed : (error instanceof Error ? error.message : '页面实时解析失败'),
          truncated: false,
          sourceUrl: url,
        }
      }
    }), 'preview-url: register')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-preview-url',
        moduleName: '@tiggyknowledge/client-preview-url',
        label: 'URL Preview',
        description: 'Live web page preview',
      }],
    })
  }
}

export default UrlPreview
