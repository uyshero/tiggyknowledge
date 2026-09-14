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
import TextProducer from '@tiggyknowledge/producer-text'
import { describe, expect, it } from 'vitest'
import TaggedIngestion from '../src/index.ts'

describe('tagged ingestion', () => {
  it('normalizes and applies batch tags only to newly imported documents', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-ingestion-tags-'))
    const ctx = new Context()
    try {
      await ctx.plugin(CatalogSqlite, { dataDir })
      await ctx.plugin(ContentLocal, { dataDir })
      await ctx.plugin(MetadataSqlite, { dataDir })
      await ctx.plugin(TextProducer)
      await ctx.plugin(BasicChunker)
      await ctx.plugin(FtsIndex, { dataDir })
      await ctx.plugin(KnowledgeIngestion)
      await ctx.plugin(DocumentMetadata)
      await ctx.plugin(TaggedIngestion)

      const library = ctx.knowledgeCatalog.createLibrary({ name: '批量标签测试库' })
      const bytes = new TextEncoder().encode('# 批量标签\n\n正文')
      const first = await ctx.knowledgeTaggedIngestion.ingest(library.id, [{ name: 'tagged.md', bytes }], ['产品', 'product', '产品'])
      const documentId = first.results[0]?.document?.id ?? ''

      expect(first).toMatchObject({ importedFiles: 1, duplicateFiles: 0 })
      expect(ctx.knowledgeMetadata.get(documentId).tags.map(tag => tag.name)).toEqual(['product', '产品'])

      const duplicate = await ctx.knowledgeTaggedIngestion.ingest(library.id, [{ name: 'copy.md', bytes }], ['不应覆盖'])
      expect(duplicate).toMatchObject({ importedFiles: 0, duplicateFiles: 1 })
      expect(ctx.knowledgeMetadata.get(documentId).tags.map(tag => tag.name)).toEqual(['product', '产品'])
      await expect(ctx.knowledgeTaggedIngestion.ingest(library.id, [{ name: 'invalid.md', bytes: new TextEncoder().encode('invalid') }], Array.from({ length: 11 }, (_, index) => `标签${index}`))).rejects.toThrow('最多设置 10 个标签')
      expect(ctx.knowledgeCatalog.summary().documents).toBe(1)
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
