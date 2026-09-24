import { basename, extname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/producer-text'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pdfProducer: PdfProducer
  }
}

const MAX_PDF_PAGES = 5_000
const MAX_EXTRACTED_CHARACTERS = 2_000_000

export interface ExtractedPdf {
  title: string
  pages: string[]
  pageCount: number
  truncated: boolean
}

interface PdfTextItem {
  str: string
  hasEOL?: boolean
}

function isTextItem(value: unknown): value is PdfTextItem {
  return typeof value === 'object' && value !== null && typeof (value as { str?: unknown }).str === 'string'
}

function pageText(items: unknown[]): string {
  const lines: string[] = []
  let line = ''
  for (const item of items) {
    if (!isTextItem(item)) continue
    const text = item.str.trim()
    if (text.length > 0) line += `${line.length === 0 ? '' : ' '}${text}`
    if (item.hasEOL === true && line.length > 0) {
      lines.push(line)
      line = ''
    }
  }
  if (line.length > 0) lines.push(line)
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function readableTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const title = value.trim()
  return title.length === 0 ? undefined : title
}

export class PdfProducer extends Service {
  static inject = ['textProducer']

  constructor(ctx: Context) {
    super(ctx, 'pdfProducer')
    ctx.effect(() => ctx.textProducer.register(['.pdf'], async (fileName, bytes) => {
      const extracted = await this.extract(fileName, bytes)
      return {
        title: extracted.title,
        body: extracted.pages.some(page => page.trim().length > 0)
          ? extracted.pages.join('\n\f\n')
          : '扫描 PDF，尚未进行 OCR 文字识别。',
        sourceType: 'pdf',
      }
    }), 'producer-pdf: register')
  }

  async extract(fileName: string, bytes: Uint8Array): Promise<ExtractedPdf> {
    const loadingTask = getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false })
    let document: Awaited<typeof loadingTask.promise> | undefined
    try {
      document = await loadingTask.promise
      const metadata = await document.getMetadata().catch(() => undefined)
      const info = metadata?.info as Record<string, unknown> | undefined
      const fallback = basename(fileName, extname(fileName)).trim() || fileName
      const title = readableTitle(info?.Title) ?? fallback
      const pages: string[] = []
      let characters = 0
      const pageLimit = Math.min(document.numPages, MAX_PDF_PAGES)
      let truncated = document.numPages > MAX_PDF_PAGES
      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        const extracted = pageText(content.items)
        const remaining = MAX_EXTRACTED_CHARACTERS - characters
        if (extracted.length > remaining) {
          pages.push(extracted.slice(0, Math.max(0, remaining)))
          truncated = true
          break
        }
        pages.push(extracted)
        characters += extracted.length
      }
      return { title, pages, pageCount: document.numPages, truncated }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('PDF ')) throw error
      if (error instanceof Error && error.name === 'PasswordException') throw new Error('PDF 已加密，暂时无法导入')
      throw new Error('PDF 文件无法解析')
    } finally {
      await loadingTask.destroy()
    }
  }
}

export default PdfProducer
