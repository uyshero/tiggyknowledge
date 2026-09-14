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
import TaggedIngestion from '@tiggyknowledge/ingestion-tags'
import MetadataSqlite from '@tiggyknowledge/metadata-sqlite'
import TextPreview from '@tiggyknowledge/preview-text'
import TextProducer from '@tiggyknowledge/producer-text'
import { describe, expect, it } from 'vitest'
import KnowledgeNoteCreator from '../src/index.ts'

describe('knowledge note creator', () => {
  it('creates an indexed Markdown source through the ingestion pipeline', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-note-creator-'))
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
      await ctx.plugin(DocumentMetadata)
      await ctx.plugin(TaggedIngestion)
      await ctx.plugin(KnowledgeNoteCreator)

      const library = ctx.knowledgeCatalog.createLibrary({ name: '笔记测试库' })
      const document = await ctx.knowledgeNoteCreator.create(library.id, {
        title: '部署检查清单',
        body: 'NoteCreatorKeyword\n\n- 检查索引\n- 检查 OKF',
        tagNames: ['运维', '清单'],
      })

      expect(document).toMatchObject({ libraryId: library.id, title: '部署检查清单', sourceType: 'markdown', indexStatus: 'ready' })
      expect(document.originalName).toMatch(/^部署检查清单-[a-f0-9]{8}\.md$/)
      expect(ctx.knowledgeMetadata.get(document.id).tags.map(tag => tag.name)).toEqual(['清单', '运维'])
      await expect(ctx.knowledgePreview.preview(document.id)).resolves.toMatchObject({
        content: expect.stringContaining('NoteCreatorKeyword'),
        format: 'markdown',
      })
      await expect(ctx.knowledgeNoteCreator.create(library.id, { title: '空正文', body: ' ', tagNames: [] })).rejects.toThrow('正文长度')
      expect(ctx.knowledgeCatalog.summary().documents).toBe(1)
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
