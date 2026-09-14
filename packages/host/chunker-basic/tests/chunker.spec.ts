import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import BasicChunker from '../src/index.ts'

describe('basic chunker', () => {
  it('uses markdown heading paths as locations', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(BasicChunker)
    try {
      const chunks = ctx.knowledgeChunker.chunk({
        body: '# 产品\n\n简介\n\n## 安装\n\n安装步骤',
        sourceType: 'markdown',
      })
      expect(chunks.map(chunk => chunk.location)).toEqual(['产品', '产品 / 安装'])
      expect(chunks[1]?.body).toContain('安装步骤')
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('reports text line ranges and caps every chunk at 1200 characters', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(BasicChunker)
    try {
      const chunks = ctx.knowledgeChunker.chunk({
        body: `第一段\n\n${'长内容 '.repeat(700)}`,
        sourceType: 'text',
      })
      expect(chunks[0]?.location).toBe('第 1 行')
      expect(chunks.every(chunk => chunk.body.length <= 1200)).toBe(true)
      expect(chunks.map(chunk => chunk.body).join('')).toContain('长内容')
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('keeps PDF page locations across chunks', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(BasicChunker)
    try {
      const chunks = ctx.knowledgeChunker.chunk({
        body: '第一页内容\n\f\n第二页 TiggyPdfKeyword',
        sourceType: 'pdf',
      })
      expect(chunks.map(chunk => chunk.location)).toEqual(['第 1 页', '第 2 页'])
      expect(chunks[1]?.body).toContain('TiggyPdfKeyword')
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })
})
