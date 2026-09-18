import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import CatalogSqlite from '@tiggyknowledge/catalog-sqlite'
import BasicChunker from '@tiggyknowledge/chunker-basic'
import ContentLocal from '@tiggyknowledge/content-local'
import DocumentMetadata from '@tiggyknowledge/document-metadata'
import FtsIndex from '@tiggyknowledge/index-fts'
import KnowledgeIngestion from '@tiggyknowledge/ingestion'
import MetadataSqlite from '@tiggyknowledge/metadata-sqlite'
import TextPreview from '@tiggyknowledge/preview-text'
import TextProducer from '@tiggyknowledge/producer-text'
import KnowledgeQueryService from '@tiggyknowledge/query'
import KnowledgeSemanticCapabilities from '@tiggyknowledge/semantic-capabilities'
import UrlProducer from '@tiggyknowledge/producer-url'
import { describe, expect, it } from 'vitest'
import KnowledgeDocuments from '../src/index.ts'

describe('knowledge documents', () => {
  it('lists, previews, and deletes documents with their search index', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-documents-'))
    const ctx = new Context()
    try {
      await ctx.plugin(CatalogSqlite, { dataDir })
      await ctx.plugin(ContentLocal, { dataDir })
      await ctx.plugin(MetadataSqlite, { dataDir })
      await ctx.plugin(TextProducer)
      await ctx.plugin(BasicChunker)
      await ctx.plugin(FtsIndex, { dataDir })
      await ctx.plugin(KnowledgeIngestion)
      await ctx.plugin(TextPreview)
      await ctx.plugin(KnowledgeDocuments)
      await ctx.plugin(DocumentMetadata)
      await ctx.plugin(KnowledgeSemanticCapabilities)
      await ctx.plugin(KnowledgeQueryService)

      const library = ctx.knowledgeCatalog.createLibrary({ name: '文档测试库' })
      const imported = await ctx.knowledgeIngestion.ingest(library.id, [
        { name: 'guide.md', bytes: new TextEncoder().encode('# 使用指南\n\nDeleteKeyword 删除索引测试') },
        { name: 'notes.txt', bytes: new TextEncoder().encode('RetainKeyword 保留的笔记') },
      ])
      const documentId = imported.results[0]?.document?.id
      expect(documentId).toBeTypeOf('string')

      const listed = ctx.knowledgeDocuments.list(library.id)
      expect(listed.library).toMatchObject({ id: library.id, documentCount: 2 })
      expect(listed.items.map(document => document.originalName).sort()).toEqual(['guide.md', 'notes.txt'])
      await expect(ctx.knowledgePreview.preview(documentId ?? '')).resolves.toMatchObject({
        document: { id: documentId, title: '使用指南' },
        format: 'markdown',
        truncated: false,
      })
      expect((await ctx.knowledgePreview.preview(documentId ?? '')).content).toContain('DeleteKeyword')
      expect(ctx.knowledgeDocuments.source(documentId ?? '')).toMatchObject({
        document: { id: documentId, originalName: 'guide.md' },
      })
      expect(new TextDecoder().decode(ctx.knowledgeDocuments.source(documentId ?? '').bytes)).toContain('DeleteKeyword')
      expect(ctx.knowledgeQuery.search({ text: 'DeleteKeyword', knowledgeBaseIds: [] }).total).toBe(1)
      const renamed = ctx.knowledgeDocuments.updateTitle(documentId ?? '', { title: '重命名后的条目' })
      expect(renamed.title).toBe('重命名后的条目')
      expect(ctx.knowledgeQuery.search({ text: '重命名后的条目', knowledgeBaseIds: [] }).total).toBe(1)
      ctx.knowledgeMetadata.setTags(documentId ?? '', ['规范'])
      const edited = ctx.knowledgeDocuments.updateMarkdownNote(documentId ?? '', { title: '使用指南更新', body: 'UpdatedKeyword 重新索引测试', tagNames: ['产品'] })
      expect(edited.title).toBe('使用指南更新')
      expect(ctx.knowledgeMetadata.get(documentId ?? '').tags.map(tag => tag.name)).toEqual(['产品'])
      await expect(ctx.knowledgePreview.preview(documentId ?? '')).resolves.toMatchObject({ document: { title: '使用指南更新' } })
      expect((await ctx.knowledgePreview.preview(documentId ?? '')).content).toContain('UpdatedKeyword')
      expect(ctx.knowledgeQuery.search({ text: 'UpdatedKeyword', knowledgeBaseIds: [] }).total).toBe(1)
      const history = ctx.knowledgeDocuments.listRevisions(documentId ?? '')
      expect(history.currentVersion).toBe(2)
      expect(history.items).toMatchObject([{ version: 1, title: '使用指南', body: 'DeleteKeyword 删除索引测试' }])
      const reverted = ctx.knowledgeDocuments.revertRevision(documentId ?? '', 1)
      expect(reverted.title).toBe('使用指南')
      expect(ctx.knowledgeMetadata.get(documentId ?? '').tags.map(tag => tag.name)).toEqual(['产品'])
      expect((await ctx.knowledgePreview.preview(documentId ?? '')).content).toContain('DeleteKeyword')
      expect(ctx.knowledgeDocuments.listRevisions(documentId ?? '').items.map(item => item.version)).toEqual([2, 1])

      expect(ctx.knowledgeDocuments.delete([documentId ?? ''])).toEqual({ deletedIds: [documentId] })
      expect(ctx.knowledgeDocuments.list(library.id).items).toHaveLength(1)
      expect(ctx.knowledgeQuery.search({ text: 'DeleteKeyword', knowledgeBaseIds: [] }).results).toEqual([])
      await expect(ctx.knowledgePreview.preview(documentId ?? '')).rejects.toThrow('知识条目不存在')
      expect(() => ctx.knowledgeDocuments.source(documentId ?? '')).toThrow('知识条目不存在')
      expect(() => ctx.knowledgeDocuments.delete([documentId ?? ''])).toThrow('知识条目不存在')

      const remainingId = ctx.knowledgeDocuments.list(library.id).items[0]?.id ?? ''
      ctx.knowledgeMetadata.setTags(remainingId, ['待删除'])
      ctx.knowledgeMetadata.setFavorite(remainingId, true)
      expect(ctx.knowledgeQuery.search({ text: 'RetainKeyword', knowledgeBaseIds: [] }).total).toBe(1)
      expect(ctx.knowledgeDocuments.deleteLibrary(library.id)).toEqual({
        deletedLibraryId: library.id,
        deletedDocumentIds: [remainingId],
      })
      expect(ctx.knowledgeCatalog.summary()).toMatchObject({ libraries: 0, documents: 0 })
      expect(ctx.knowledgeQuery.search({ text: 'RetainKeyword', knowledgeBaseIds: [] }).results).toEqual([])
      expect(ctx.knowledgeMetadata.favoriteDocuments()).toEqual([])
      expect(ctx.knowledgeMetadata.listTags()).toEqual([])
      expect(() => ctx.knowledgeDocuments.list(library.id)).toThrow('知识库不存在')
      expect(() => ctx.knowledgeDocuments.deleteLibrary(library.id)).toThrow('知识库不存在')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('reindexes webpage text extracted from a live preview', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-url-content-'))
    const ctx = new Context()
    try {
      await ctx.plugin(CatalogSqlite, { dataDir })
      await ctx.plugin(ContentLocal, { dataDir })
      await ctx.plugin(MetadataSqlite, { dataDir })
      await ctx.plugin(TextProducer)
      await ctx.plugin(UrlProducer, {
        fetchPage: async (url: string) => ({ url, title: 'blog.example.com', text: '', truncated: false }),
      })
      await ctx.plugin(BasicChunker)
      await ctx.plugin(FtsIndex, { dataDir })
      await ctx.plugin(KnowledgeIngestion)
      await ctx.plugin(TextPreview)
      await ctx.plugin(KnowledgeDocuments)
      await ctx.plugin(DocumentMetadata)
      await ctx.plugin(KnowledgeSemanticCapabilities)
      await ctx.plugin(KnowledgeQueryService)

      const library = ctx.knowledgeCatalog.createLibrary({ name: '网页索引库' })
      const imported = await ctx.knowledgeIngestion.ingest(library.id, [
        { name: 'blog.example.com-abcd1234.url', bytes: new TextEncoder().encode('[InternetShortcut]\nURL=https://blog.example.com/article\n') },
        { name: 'notes.md', bytes: new TextEncoder().encode('# 笔记\n\n普通笔记') },
      ])
      const documentId = imported.results[0]?.document?.id ?? ''
      const noteId = imported.results[1]?.document?.id ?? ''
      expect(documentId).toBeTypeOf('string')
      expect(ctx.knowledgeQuery.search({ text: 'vLLMKeyword', knowledgeBaseIds: [] }).total).toBe(0)

      const updated = ctx.knowledgeDocuments.updateUrlExtractedContent(documentId, {
        title: '如何部署推理服务',
        text: 'vLLMKeyword 可以用来部署大模型推理服务，并说明安装步骤与参数。',
      })
      expect(updated.title).toBe('如何部署推理服务')
      expect(ctx.knowledgeQuery.search({ text: 'vLLMKeyword', knowledgeBaseIds: [] }).total).toBe(1)
      expect(() => ctx.knowledgeDocuments.updateUrlExtractedContent(noteId, {
        text: '这段正文不应该写入 Markdown 条目。',
      })).toThrow('只有网页知识条目支持同步页面正文')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
