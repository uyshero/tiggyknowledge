import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import KnowledgeSemanticCapabilities from '../src/index.ts'

describe('semantic capability registry', () => {
  it('reports keyword-only search until a provider is registered', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(KnowledgeSemanticCapabilities)
    try {
      expect(ctx.knowledgeSemanticCapabilities.snapshot()).toMatchObject({
        enabledModes: ['keyword'],
        semantic: {
          status: 'not-configured',
          providers: [],
        },
      })
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('exposes registered semantic providers as runtime capabilities', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(KnowledgeSemanticCapabilities)
    try {
      const dispose = ctx.knowledgeSemanticCapabilities.registerProvider({
        id: 'deepseek-embedding',
        label: 'DeepSeek Embedding',
        model: 'deepseek-embedding',
        dimensions: 1024,
        modes: ['semantic', 'hybrid'],
      })
      expect(ctx.knowledgeSemanticCapabilities.snapshot()).toMatchObject({
        enabledModes: ['keyword', 'semantic', 'hybrid'],
        semantic: {
          status: 'available',
          providers: [{ id: 'deepseek-embedding', status: 'active' }],
        },
      })
      dispose()
      expect(ctx.knowledgeSemanticCapabilities.hasSemanticSearch()).toBe(false)
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })
})
