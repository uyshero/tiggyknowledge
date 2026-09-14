import { Context } from '@deepseek-ai/cordis'
import TextProducer from '@tiggyknowledge/producer-text'
import { describe, expect, it } from 'vitest'
import PdfProducer from '../src/index.ts'
import { minimalPdf } from './fixture.ts'

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
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
