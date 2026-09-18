import { Context, Service } from '@deepseek-ai/cordis'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/preview-text'
import type {} from '@tiggyknowledge/producer-pdf'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pdfPreview: PdfPreview
  }
}

// PdfProducer caps extracted body text at 2M; leave room for page headings.
const MAX_PREVIEW_CHARACTERS = 2_100_000

export class PdfPreview extends Service {
  static inject = ['knowledgePreview', 'pdfProducer']

  constructor(ctx: Context) {
    super(ctx, 'pdfPreview')
    ctx.effect(() => ctx.knowledgePreview.register(['pdf'], async (document, bytes) => {
      const extracted = await ctx.pdfProducer.extract(document.originalName, bytes)
      const content = extracted.pages
        .map((page, index) => `第 ${index + 1} 页\n\n${page}`)
        .join('\n\n')
      return {
        content: content.slice(0, MAX_PREVIEW_CHARACTERS),
        truncated: extracted.truncated || content.length > MAX_PREVIEW_CHARACTERS,
        pageCount: extracted.pageCount,
      }
    }), 'preview-pdf: register')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-preview-pdf',
        moduleName: '@tiggyknowledge/client-preview-pdf',
        label: 'PDF Preview',
        description: 'Visual PDF page renderer',
      }],
    })
  }
}

export default PdfPreview
