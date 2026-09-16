import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import CatalogSqlite from '@tiggyknowledge/catalog-sqlite'
import ContentLocal from '@tiggyknowledge/content-local'
import LlmCredentials from '@tiggyknowledge/llm-credentials'
import TextPreview from '@tiggyknowledge/preview-text'
import FileSettings from '@tiggyknowledge/settings-file'
import WikiSqlite from '@tiggyknowledge/wiki-sqlite'
import { describe, expect, it, vi } from 'vitest'
import LlmWiki from '../src/index.ts'

describe('LLM Wiki generation', () => {
  it('summarizes sources, synthesizes cited pages, and skips unchanged incremental work', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-llm-wiki-'))
    const ctx = new Context()
    const complete = vi.fn()
      .mockResolvedValueOnce({ content: '这是一篇测试文档的摘要。', inputTokens: 20, outputTokens: 8 })
      .mockImplementationOnce(async input => {
        const userContent = input.messages.at(-1)?.content ?? ''
        const payload = JSON.parse(userContent) as { documents: Array<{ documentId: string }> }
        const documentId = payload.documents[0]?.documentId
        return {
          content: JSON.stringify({
          candidates: [
            {
              title: '测试总览',
              slug: 'overview',
              pageType: 'concept',
              aliases: ['测试主题'],
              purpose: '帮助理解并复用测试主题的核心知识。',
              questions: ['测试主题包含哪些核心事实？'],
              folderPath: ['概念'],
              sourceDocumentIds: [documentId],
              factCount: 4,
              referencePotential: 2,
              stableIdentity: true,
              transient: false,
              estimatedCharacters: 400,
              reasons: ['可独立解释'],
            },
            {
              title: '测试主题',
              slug: 'testing-topic',
              pageType: 'concept',
              aliases: ['测试总览'],
              purpose: '提供测试主题的统一概念解释。',
              questions: ['测试主题是什么意思？'],
              folderPath: ['概念'],
              sourceDocumentIds: [documentId],
              factCount: 3,
              referencePotential: 2,
              stableIdentity: true,
              transient: false,
              estimatedCharacters: 300,
              reasons: ['可被引用'],
            },
            {
              title: '临时通知',
              slug: 'temporary-notice',
              pageType: 'concept',
              aliases: [],
              purpose: '记录一次性临时信息。',
              questions: ['临时通知是什么？'],
              folderPath: ['其他'],
              sourceDocumentIds: [documentId],
              factCount: 1,
              referencePotential: 0,
              stableIdentity: false,
              transient: true,
              estimatedCharacters: 80,
              reasons: ['一次性内容'],
            },
          ],
          }),
          inputTokens: 5,
          outputTokens: 7,
        }
      })
      .mockResolvedValueOnce({ content: '{"pages":[', inputTokens: 1, outputTokens: 4_000 })
      .mockImplementationOnce(async input => {
        const userContent = input.messages.at(-1)?.content ?? ''
        const payload = JSON.parse(userContent) as { documents: Array<{ documentId: string }> }
        return {
          content: JSON.stringify({
            pages: [{
              title: '测试总览',
              slug: 'overview',
              pageType: 'concept',
              aliases: ['测试主题'],
              parentSlug: null,
              sections: [{
                title: '核心内容',
                body: '由测试文档生成的 Wiki 正文。',
                sourceDocumentIds: [payload.documents[0]?.documentId],
              }],
            }, {
              title: '测试主题',
              slug: 'testing-topic',
              pageType: 'concept',
              aliases: ['测试总览'],
              parentSlug: null,
              sections: [{
                title: '补充内容',
                body: '这是同义名称下的补充内容。',
                sourceDocumentIds: [payload.documents[0]?.documentId],
              }],
            }],
          }),
          inputTokens: 10,
          outputTokens: 15,
        }
      })
    delete process.env.TIGGYKNOWLEDGE_LLM_API_KEY
    ctx.provide('secretCodec', {
      encrypt: value => Buffer.from(value).toString('base64'),
      decrypt: value => Buffer.from(value, 'base64').toString(),
    })
    try {
      await ctx.plugin(CatalogSqlite, { dataDir })
      await ctx.plugin(ContentLocal, { dataDir })
      await ctx.plugin(TextPreview)
      await ctx.plugin(FileSettings, { path: join(dataDir, 'settings.yaml') })
      await ctx.plugin(LlmCredentials, { dataDir })
      await ctx.plugin(WikiSqlite, { dataDir })
      ctx.wikiStorage.createGeneration({
        id: 'interrupted-generation',
        mode: 'initial',
        state: 'running',
        phase: 'summarizing',
        totalSteps: 2,
        completedSteps: 1,
        estimatedInputTokens: 100,
        inputTokens: 20,
        outputTokens: 8,
        createdAt: '2026-09-15T00:00:00.000Z',
      })
      ctx.provide('llmClient', { complete })
      await ctx.plugin(LlmWiki)
      expect(ctx.llmWiki.generation('interrupted-generation')).toMatchObject({
        state: 'failed',
        phase: 'failed',
        error: '应用已重启，先前的 Wiki 生成任务未能完成',
      })

      ctx.settings.updateLlmIntegration({ enabled: true, model: 'test-model' })
      ctx.llmCredentials.setApiKey('sk-test-wiki-key')
      const library = ctx.knowledgeCatalog.createLibrary({ name: 'Wiki 测试库' })
      const bytes = new TextEncoder().encode('# 测试文档\n\n这是生成 Wiki 所需的事实。')
      const asset = ctx.knowledgeContent.save(bytes)
      ctx.knowledgeCatalog.registerAsset(asset)
      const document = ctx.knowledgeCatalog.createDocument({
        libraryId: library.id,
        title: '测试文档',
        originalName: 'test.md',
        sourceType: 'markdown',
        sourceAssetId: asset.id,
        contentHash: asset.contentHash,
        sizeBytes: asset.sizeBytes,
      })

      const generation = ctx.llmWiki.start({ mode: 'initial' })
      await vi.waitFor(() => expect(ctx.llmWiki.generation(generation.id).state).toBe('completed'))
      expect(ctx.llmWiki.generation(generation.id)).toMatchObject({
        completedSteps: 3,
        inputTokens: 36,
        outputTokens: 4_030,
        candidateCount: 3,
        acceptedCandidateCount: 1,
      })
      expect(ctx.llmWiki.pages()).toEqual(expect.arrayContaining([
        expect.objectContaining({ slug: 'index', pageType: 'index' }),
        expect.objectContaining({ slug: 'concept/overview', title: '测试总览' }),
      ]))
      expect(ctx.llmWiki.folders()).toMatchObject([{ name: '概念', depth: 0 }])
      expect(ctx.llmWiki.page('concept/overview')).toMatchObject({
        aliases: ['测试主题'],
        purpose: '帮助理解并复用测试主题的核心知识。',
        questions: ['测试主题包含哪些核心事实？', '测试主题是什么意思？'],
        sections: [
          { sources: [{ documentId: document.id, libraryId: library.id }] },
          { title: '补充内容' },
        ],
      })
      expect(ctx.llmWiki.status()).toMatchObject({ state: 'ready', pageCount: 2 })
      expect(ctx.llmWiki.status().lastGeneration).toMatchObject({ id: generation.id, state: 'completed' })
      expect(complete.mock.calls[0]?.[0]).toMatchObject({ maxAttempts: 3 })
      expect(complete.mock.calls[1]?.[0]).toMatchObject({
        maxAttempts: 3,
        settings: { requestTimeoutMs: 180_000 },
      })
      expect(complete.mock.calls[2]?.[0]).toMatchObject({
        maxAttempts: 3,
        settings: { requestTimeoutMs: 180_000 },
      })
      expect(complete.mock.calls[3]?.[0]).toMatchObject({
        maxAttempts: 2,
        settings: { requestTimeoutMs: 180_000 },
      })

      const incremental = ctx.llmWiki.start({ mode: 'incremental' })
      await vi.waitFor(() => expect(ctx.llmWiki.generation(incremental.id).state).toBe('completed'))
      expect(ctx.llmWiki.generation(incremental.id).totalSteps).toBe(0)
      expect(complete).toHaveBeenCalledTimes(4)
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
