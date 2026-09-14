import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import CatalogSqlite from '@tiggyknowledge/catalog-sqlite'
import BasicChunker from '@tiggyknowledge/chunker-basic'
import ContentLocal from '@tiggyknowledge/content-local'
import FtsIndex from '@tiggyknowledge/index-fts'
import KnowledgeIngestion from '@tiggyknowledge/ingestion'
import PdfProducer from '@tiggyknowledge/producer-pdf'
import TextProducer from '@tiggyknowledge/producer-text'
import TextPreview from '@tiggyknowledge/preview-text'
import { describe, expect, it } from 'vitest'
import { minimalPdf } from '../../producer-pdf/tests/fixture.ts'
import PdfPreview from '../src/index.ts'

describe('pdf preview plugin', () => {
  it('previews an imported PDF as page-aware extracted text', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-pdf-preview-'))
    const ctx = new Context()
    try {
      await ctx.plugin(CatalogSqlite, { dataDir })
      await ctx.plugin(ContentLocal, { dataDir })
      await ctx.plugin(TextProducer)
      await ctx.plugin(PdfProducer)
      await ctx.plugin(BasicChunker)
      await ctx.plugin(FtsIndex, { dataDir })
      await ctx.plugin(KnowledgeIngestion)
      await ctx.plugin(TextPreview)
      await ctx.plugin(PdfPreview)

      const library = ctx.knowledgeCatalog.createLibrary({ name: 'PDF 测试库' })
      const imported = await ctx.knowledgeIngestion.ingest(library.id, [{ name: 'brief.pdf', bytes: minimalPdf() }])
      const documentId = imported.results[0]?.document?.id ?? ''
      expect(imported.results[0]).toMatchObject({ status: 'imported', document: { sourceType: 'pdf', indexStatus: 'ready' } })
      await expect(ctx.knowledgePreview.preview(documentId)).resolves.toMatchObject({
        format: 'pdf',
        pageCount: 1,
        truncated: false,
        content: expect.stringContaining('第 1 页'),
      })
      expect((await ctx.knowledgePreview.preview(documentId)).content).toContain('TiggyPdfKeyword')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
