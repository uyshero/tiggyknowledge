import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import CatalogSqlite from '@tiggyknowledge/catalog-sqlite'
import BasicChunker from '@tiggyknowledge/chunker-basic'
import ContentLocal from '@tiggyknowledge/content-local'
import FtsIndex from '@tiggyknowledge/index-fts'
import TextProducer from '@tiggyknowledge/producer-text'
import { describe, expect, it } from 'vitest'
import KnowledgeIngestion from '../src/index.ts'

describe('knowledge ingestion', () => {
  it('imports supported files, isolates failures, and detects duplicates', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-ingestion-'))
    const ctx = new Context()
    try {
      await ctx.plugin(CatalogSqlite, { dataDir })
      await ctx.plugin(ContentLocal, { dataDir })
      await ctx.plugin(TextProducer)
      await ctx.plugin(BasicChunker)
      await ctx.plugin(FtsIndex, { dataDir })
      await ctx.plugin(KnowledgeIngestion)
      const library = ctx.knowledgeCatalog.createLibrary({ name: '测试库' })
      const markdown = new TextEncoder().encode('# 产品规范\n\n正文内容')

      const first = await ctx.knowledgeIngestion.ingest(library.id, [
        { name: 'product.md', bytes: markdown },
        { name: 'unsupported.pdf', bytes: new Uint8Array([1, 2, 3]) },
      ])
      expect(first).toMatchObject({ totalFiles: 2, importedFiles: 1, duplicateFiles: 0, failedFiles: 1 })
      expect(first.results[0]).toMatchObject({ status: 'imported', document: { title: '产品规范', indexStatus: 'ready' } })
      expect(first.results[1]).toMatchObject({ status: 'failed' })
      expect(ctx.knowledgeCatalog.summary().documents).toBe(1)

      const second = await ctx.knowledgeIngestion.ingest(library.id, [{ name: 'copy.md', bytes: markdown }])
      expect(second).toMatchObject({ importedFiles: 0, duplicateFiles: 1, failedFiles: 0 })
      expect(ctx.knowledgeCatalog.summary().documents).toBe(1)
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
