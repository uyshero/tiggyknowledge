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
import LlmWiki, { packSegmentSummaries, parseSegmentSummaries, splitDocumentForModel } from '../src/index.ts'

describe('LLM Wiki generation', () => {
  it('splits long documents without dropping content', () => {
    const content = Array.from({ length: 40 }, (_, index) => `第${index + 1}段：${'全文内容'.repeat(500)}\n\n`).join('')
    const chunks = splitDocumentForModel(content, 4_000)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(content)
    expect(chunks.every(chunk => chunk.length <= 12_002)).toBe(true)
  })

  it('packs every complete segment into synthesis batches without truncation', () => {
    const summary = Array.from({ length: 40 }, (_, index) => `## 第 ${index + 1}/40 段\n${`要点${index + 1}`.repeat(100)}`).join('\n\n')
    const parts = parseSegmentSummaries(summary)
    const batches = packSegmentSummaries(parts, 4_000)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.every(batch => batch.join('\n\n').length <= 4_000)).toBe(true)
    expect(batches.flat()).toEqual(parts)
    expect(batches.at(-1)?.at(-1)).toContain('## 第 40/40 段')
  })

  it('confirms one document at a time and generates a cited page in the background', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-llm-wiki-'))
    const ctx = new Context()
    let assistDocumentId = ''
    let assistLibraryId = ''
    const complete = vi.fn()
      .mockResolvedValueOnce({ content: '这是一篇测试文档的摘要。', inputTokens: 20, outputTokens: 8 })
      .mockResolvedValueOnce({ content: '{"pages":[', inputTokens: 1, outputTokens: 4_000 })
      .mockImplementationOnce(async input => {
        const userContent = input.messages.at(-1)?.content ?? ''
        const payload = JSON.parse(userContent) as { document: { documentId: string, title: string } }
        return {
          content: JSON.stringify({
            pages: [{
              title: '测试总览',
              slug: 'topic/overview',
              pageType: 'topic',
              aliases: ['测试主题'],
              purpose: '帮助理解测试主题。',
              questions: ['测试主题包含哪些核心事实？'],
              folderPath: ['其他'],
              parentSlug: null,
              sections: [{
                title: '核心内容',
                body: '由测试文档生成的 Wiki 正文。',
                sourceDocumentIds: [payload.document.documentId],
              }],
            }],
          }),
          inputTokens: 10,
          outputTokens: 15,
        }
      })
      .mockResolvedValue({
        content: JSON.stringify({
          summary: '手动词条的简明摘要。',
          purpose: '帮助理解手动词条。',
          questions: ['它是什么？'],
          sectionTitle: '解释',
          body: '这是 AI 补充并等待用户确认的解释草稿。',
        }),
        inputTokens: 8,
        outputTokens: 12,
      })
    delete process.env.TIGGYKNOWLEDGE_LLM_API_KEY
    ctx.provide('secretCodec', {
      encrypt: value => Buffer.from(value).toString('base64'),
      decrypt: value => Buffer.from(value, 'base64').toString(),
    })
      ctx.provide('knowledgeQuery', {
        search: input => ({
          query: input.text,
          mode: 'keyword',
          total: assistDocumentId === '' ? 0 : 1,
          results: assistDocumentId === '' ? [] : [{
            chunkId: `${assistDocumentId}:0`,
            knowledgeBaseId: assistLibraryId,
            documentId: assistDocumentId,
            title: '测试文档',
            originalName: 'test.md',
            sourceType: 'markdown',
            location: '第 1 段',
            snippet: '手动词条用于测试知识库依据。',
            score: 1,
            tags: [],
            isFavorite: false,
          }],
        }),
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
        mode: 'document',
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

      ctx.settings.updateLlmIntegration({
        providers: [{
          id: 'test-provider',
          name: '测试提供方',
          baseUrl: 'https://llm.example.test/v1',
          models: [{ id: 'test-model', model: 'test-model' }],
        }],
        preferredModelId: 'test-model',
      })
      ctx.llmCredentials.setApiKey('test-provider', 'sk-test-wiki-key')
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
      assistDocumentId = document.id
      assistLibraryId = library.id

      expect(ctx.llmWiki.status().inbox).toEqual([expect.objectContaining({
        documentId: document.id,
        change: 'added',
        locked: false,
      })])
      expect(() => ctx.llmWiki.start({})).toThrow('请确认一篇知识文章后再生成词条')
      expect(() => ctx.llmWiki.confirm('interrupted-generation', { candidateSlugs: [] })).toThrow('按文章确认')

      const skipped = ctx.llmWiki.skipDocument(document.id)
      expect(skipped).toEqual([])
      expect(ctx.llmWiki.status()).toMatchObject({
        inbox: [],
        skipped: [expect.objectContaining({
          documentId: document.id,
          title: '测试文档',
          skippedAt: expect.any(String),
        })],
      })

      const replacement = ctx.knowledgeContent.save(new TextEncoder().encode('# 测试文档\n\n更新后的事实。'))
      ctx.knowledgeCatalog.registerAsset(replacement)
      ctx.knowledgeCatalog.updateDocument(document.id, {
        sourceAssetId: replacement.id,
        contentHash: replacement.contentHash,
        sizeBytes: replacement.sizeBytes,
      })
      expect(ctx.llmWiki.status()).toMatchObject({
        inbox: [expect.objectContaining({ documentId: document.id, change: 'added' })],
        skipped: [],
      })
      ctx.llmWiki.skipDocument(document.id)
      expect(ctx.llmWiki.status()).toMatchObject({
        inbox: [],
        skipped: [expect.objectContaining({ documentId: document.id })],
      })

      const generation = ctx.llmWiki.start({ documentId: document.id })
      await vi.waitFor(() => expect(ctx.llmWiki.generation(generation.id).state).toBe('completed'))
      expect(ctx.llmWiki.generation(generation.id)).toMatchObject({
        mode: 'document',
        completedSteps: 2,
        inputTokens: 31,
        outputTokens: 4_023,
      })
      expect(ctx.llmWiki.pages()).toEqual(expect.arrayContaining([
        expect.objectContaining({ slug: 'index', pageType: 'index' }),
        expect.objectContaining({ title: '测试总览' }),
      ]))
      const topic = ctx.llmWiki.pages().find(page => page.pageType !== 'index')
      expect(topic).toMatchObject({ folderId: expect.any(String), status: 'draft' })
      expect(ctx.llmWiki.page('index')).toMatchObject({ pageType: 'index', status: 'published' })
      expect(ctx.llmWiki.page('index').sections[0]?.body).toContain('## 专题')
      expect(ctx.llmWiki.page('index').sections[0]?.body).toContain(topic?.title)
      expect(ctx.llmWiki.page(topic!.slug)).toMatchObject({
        status: 'draft',
        sections: [{ sources: [{ documentId: document.id, libraryId: library.id }] }],
      })
      expect(ctx.llmWiki.status()).toMatchObject({
        state: 'awaiting-confirmation',
        inbox: [],
        skipped: [],
        queuedDocumentIds: [],
        reviews: [expect.objectContaining({ id: topic!.id, status: 'draft' })],
      })
      expect(ctx.llmWiki.publishPage(topic!.id, topic!.version)).toMatchObject({ status: 'published' })
      expect(ctx.llmWiki.status()).toMatchObject({ state: 'ready', reviews: [] })
      const category = ctx.llmWiki.createFolder({ name: '人工分类' })
      expect(ctx.llmWiki.updateFolder(category.id, { name: '人工维护' })).toMatchObject({ name: '人工维护', path: '人工维护' })
      const assisted = await ctx.llmWiki.assistPage({ title: '手动词条', pageType: 'event', notes: '用于测试' })
      expect(assisted).toMatchObject({
        summary: '手动词条的简明摘要。',
        sectionTitle: '解释',
        body: expect.stringContaining('AI 补充'),
        sourceDocumentIds: [document.id],
      })
      const assistPayload = JSON.parse(complete.mock.calls.at(-1)?.[0].messages.at(-1)?.content ?? '{}') as {
        knowledgeEvidence?: Array<{ documentId: string, snippet: string }>
      }
      expect(assistPayload.knowledgeEvidence).toEqual([
        expect.objectContaining({ documentId: document.id, snippet: expect.stringContaining('知识库依据') }),
      ])
      const manual = ctx.llmWiki.createPage({
        title: '手动词条',
        pageType: 'event',
        folderId: category.id,
        summary: assisted.summary,
        purpose: assisted.purpose,
        questions: assisted.questions,
        sectionTitle: assisted.sectionTitle,
        sourceDocumentIds: assisted.sourceDocumentIds,
        body: assisted.body,
      })
      expect(manual).toMatchObject({
        title: '手动词条',
        pageType: 'event',
        folderId: category.id,
        state: 'locked',
        lastEditSource: 'user',
        sections: [{ sources: [{ documentId: document.id }] }],
      })
      ctx.llmWiki.deleteFolder(category.id)
      expect(ctx.llmWiki.page(manual.id).folderId).toBeUndefined()
      expect(() => ctx.llmWiki.start({ documentId: document.id })).toThrow('该词条已锁定')
      expect(complete).toHaveBeenCalledTimes(4)
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('preserves unrelated pages when confirming another document', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-llm-wiki-incremental-'))
    const ctx = new Context()
    const complete = vi.fn(async input => {
      const system = input.messages[0]?.content ?? ''
      const user = input.messages.at(-1)?.content ?? ''
      if (system.includes('知识库编辑')) {
        return { content: `摘要-${user.slice(0, 80)}`, inputTokens: 10, outputTokens: 5 }
      }
      const payload = JSON.parse(user) as {
        document: { documentId: string, title: string, contentHash: string }
        existingSlug?: string | null
      }
      return {
        content: JSON.stringify({
          pages: [{
            title: payload.document.title,
            slug: payload.existingSlug || `topic/${payload.document.title.toLowerCase()}`,
            pageType: 'topic',
            aliases: [],
            purpose: `维护${payload.document.title}。`,
            questions: [`${payload.document.title}有哪些核心事实？`],
            folderPath: ['其他'],
            parentSlug: null,
            sections: [{
              title: '核心内容',
              body: `内容版本-${payload.document.contentHash}`,
              sourceDocumentIds: [payload.document.documentId],
            }],
          }],
        }),
        inputTokens: 10,
        outputTokens: 10,
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
      ctx.provide('llmClient', { complete })
      ctx.provide('knowledgeQuery', {
        search: input => ({ query: input.text, mode: 'keyword', total: 0, results: [] }),
      })
      await ctx.plugin(LlmWiki)
      ctx.settings.updateLlmIntegration({
        providers: [{
          id: 'test-provider',
          name: '测试提供方',
          baseUrl: 'https://llm.example.test/v1',
          models: [{ id: 'test-model', model: 'test-model' }],
        }],
        preferredModelId: 'test-model',
      })
      ctx.llmCredentials.setApiKey('test-provider', 'sk-test-wiki-key')
      const library = ctx.knowledgeCatalog.createLibrary({ name: '增量测试库' })
      const createDocument = (title: string, content: string) => {
        const asset = ctx.knowledgeContent.save(new TextEncoder().encode(content))
        ctx.knowledgeCatalog.registerAsset(asset)
        return ctx.knowledgeCatalog.createDocument({
          libraryId: library.id,
          title,
          originalName: `${title}.md`,
          sourceType: 'markdown',
          sourceAssetId: asset.id,
          contentHash: asset.contentHash,
          sizeBytes: asset.sizeBytes,
        })
      }
      const documentA = createDocument('Alpha', 'Alpha 初始内容')
      const documentB = createDocument('Beta', 'Beta 不相关内容')
      const run = async (documentId: string): Promise<void> => {
        const generation = ctx.llmWiki.start({ documentId })
        await vi.waitFor(() => expect(ctx.llmWiki.generation(generation.id).state).toBe('completed'))
      }

      expect(ctx.llmWiki.status().inbox).toHaveLength(2)
      await run(documentA.id)
      expect(ctx.llmWiki.status().inbox.map(item => item.documentId)).toEqual([documentB.id])
      const alpha = ctx.llmWiki.pages().find(page => page.title === 'Alpha')
      expect(alpha).toBeDefined()
      expect(ctx.llmWiki.pages().some(page => page.title === 'Beta')).toBe(false)

      await run(documentB.id)
      const betaBefore = ctx.llmWiki.page(ctx.llmWiki.pages().find(page => page.title === 'Beta')!.id)
      const alphaBefore = ctx.llmWiki.page(alpha!.id)

      const replacement = ctx.knowledgeContent.save(new TextEncoder().encode('Alpha 更新内容'))
      ctx.knowledgeCatalog.registerAsset(replacement)
      ctx.knowledgeCatalog.updateDocument(documentA.id, {
        sourceAssetId: replacement.id,
        contentHash: replacement.contentHash,
        sizeBytes: replacement.sizeBytes,
      })
      expect(ctx.llmWiki.status().inbox).toEqual([expect.objectContaining({ documentId: documentA.id, change: 'updated' })])

      ctx.llmWiki.updatePage(alphaBefore.id, {
        title: alphaBefore.title,
        summary: alphaBefore.summary,
        pageType: alphaBefore.pageType,
        status: alphaBefore.status,
        aliases: alphaBefore.aliases,
        purpose: alphaBefore.purpose,
        questions: alphaBefore.questions,
        expectedVersion: alphaBefore.version,
        sections: alphaBefore.sections.map(section => ({ id: section.id, title: section.title, body: section.body })),
      })
      expect(ctx.llmWiki.status().inbox[0]).toMatchObject({ documentId: documentA.id, locked: true })
      expect(() => ctx.llmWiki.start({ documentId: documentA.id })).toThrow('该词条已锁定')
      ctx.llmWiki.unlockPage(alphaBefore.id, ctx.llmWiki.page(alphaBefore.id).version)
      await run(documentA.id)

      const betaAfter = ctx.llmWiki.page(betaBefore.id)
      const alphaAfter = ctx.llmWiki.page(alphaBefore.id)
      expect(betaAfter).toMatchObject({
        version: betaBefore.version,
        updatedAt: betaBefore.updatedAt,
        sections: [{ body: betaBefore.sections[0]?.body }],
      })
      expect(alphaAfter.sections[0]?.body).toContain(replacement.contentHash)
      expect(ctx.llmWiki.page('index').sections[0]?.body).toContain('Alpha')
      expect(ctx.llmWiki.page('index').sections[0]?.body).toContain('Beta')
      expect(() => ctx.llmWiki.start({ documentId: documentB.id })).toThrow('该文章对应的词条已是最新')
      const forced = ctx.llmWiki.start({ documentId: documentB.id, force: true })
      await vi.waitFor(() => expect(ctx.llmWiki.generation(forced.id).state).toBe('completed'))
      expect(ctx.llmWiki.page(betaBefore.id).title).toBe('Beta')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
