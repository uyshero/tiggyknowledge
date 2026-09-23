import { Context } from '@deepseek-ai/cordis'
import TextProducer from '@tiggyknowledge/producer-text'
import { describe, expect, it } from 'vitest'
import PdfProducer from '../src/index.ts'
import { minimalPdf, multiPagePdf } from './fixture.ts'

describe('pdf producer plugin', () => {
  it('registers PDF extraction without changing the text producer API', async () => {
    const ctx = new Context()
    await ctx.plugin(TextProducer)
    await ctx.plugin(PdfProducer)
    try {
      await expect(ctx.textProducer.produce('brief.pdf', minimalPdf())).resolves.toMatchObject({
        title: 'brief',
        sourceType: 'pdf',
        body: expect.stringContaining('TiggyPdfKeyword'),
      })
      await expect(ctx.textProducer.produce('broken.pdf', new Uint8Array([1, 2, 3]))).rejects.toThrow('无法解析')
      await expect(ctx.textProducer.produce('scan.pdf', minimalPdf(''))).rejects.toThrow('OCR 插件')
      const extracted = await ctx.pdfProducer.extract('book.pdf', multiPagePdf(3))
      expect(extracted).toMatchObject({ pageCount: 3, truncated: false })
      expect(extracted.pages).toHaveLength(3)
      expect(extracted.pages[2]).toContain('page 3')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('imports PDFs over 500 pages and only extracts the first 500 pages of text', { timeout: 30_000 }, async () => {
    const ctx = new Context()
    await ctx.plugin(TextProducer)
    await ctx.plugin(PdfProducer)
    try {
      const oversized = await ctx.pdfProducer.extract('long.pdf', multiPagePdf(501))
      expect(oversized).toMatchObject({ pageCount: 501, truncated: true })
      expect(oversized.pages).toHaveLength(500)
      expect(oversized.pages[0]).toContain('page 1')
      expect(oversized.pages[499]).toContain('page 500')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
