import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import TextProducer from '../src/index.ts'

describe('text producer', () => {
  it('uses the first markdown heading as the title', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(TextProducer)
    try {
      await expect(ctx.textProducer.produce('guide.md', new TextEncoder().encode('# 使用指南\n\n正文'))).resolves.toEqual({
        title: '使用指南',
        body: '# 使用指南\n\n正文',
        sourceType: 'markdown',
      })
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('rejects unsupported extensions and invalid UTF-8', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(TextProducer)
    try {
      await expect(ctx.textProducer.produce('notes.docx', new Uint8Array([1]))).rejects.toThrow('仅支持')
      await expect(ctx.textProducer.produce('notes.txt', new Uint8Array([0xff]))).rejects.toThrow('UTF-8')
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })
})
