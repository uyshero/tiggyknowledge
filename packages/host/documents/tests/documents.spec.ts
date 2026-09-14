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
      const edited = ctx.knowledgeDocuments.updateMarkdownNote(documentId ?? '', { title: '使用指南更新', body: 'UpdatedKeyword 重新索引测试', tagNames: [] })
      expect(edited.title).toBe('使用指南更新')
      await expect(ctx.knowledgePreview.preview(documentId ?? '')).resolves.toMatchObject({ document: { title: '使用指南更新' } })
      expect((await ctx.knowledgePreview.preview(documentId ?? '')).content).toContain('UpdatedKeyword')
      expect(ctx.knowledgeQuery.search({ text: 'UpdatedKeyword', knowledgeBaseIds: [] }).total).toBe(1)

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
})
