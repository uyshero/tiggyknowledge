import { createHash } from 'node:crypto'
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
import { describe, expect, it } from 'vitest'
import KnowledgeOkf from '../src/index.ts'

describe('knowledge OKF mapping', () => {
  it('maps an imported document to a stable concept and source asset', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-okf-'))
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
      await ctx.plugin(KnowledgeOkf)

      const library = ctx.knowledgeCatalog.createLibrary({ name: 'OKF 测试库' })
      const bytes = new TextEncoder().encode('# OKF 指南\n\nOkfRuntimeKeyword 运行时正文')
      const imported = await ctx.knowledgeIngestion.ingest(library.id, [{ name: 'okf-guide.md', bytes }])
      const document = imported.results[0]?.document
      expect(document).toBeDefined()
      ctx.knowledgeMetadata.setTags(document?.id ?? '', ['OKF', '规范'])

      const mapping = await ctx.knowledgeOkf.mapping(document?.id ?? '')
      expect(mapping).toMatchObject({
        documentId: document?.id,
        concept: {
          id: document?.id,
          type: 'Concept',
          path: `${document?.id}.md`,
          title: 'OKF 指南',
          tags: [{ name: 'OKF' }, { name: '规范' }],
          body: expect.stringContaining('OkfRuntimeKeyword'),
          generatedBy: 'process:knowledge-import/markdown',
          generatedAt: document?.createdAt,
          sources: [{
            id: document?.sourceAssetId,
            resource: `knowledge-asset://${document?.sourceAssetId}`,
            title: 'okf-guide.md',
            contentHash: createHash('sha256').update(bytes).digest('hex'),
            sizeBytes: bytes.byteLength,
          }],
        },
        storage: {
          bundleState: 'runtime-mapped',
          originalAssetId: document?.sourceAssetId,
          indexStatus: 'ready',
        },
        validation: {
          status: 'not-run',
          message: expect.stringContaining('OKF 导出插件会物化 Bundle'),
        },
      })
      await expect(ctx.knowledgeOkf.mapping('missing-document')).rejects.toThrow('知识条目不存在')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
