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
import KnowledgeOkf from '@tiggyknowledge/okf'
import TextPreview from '@tiggyknowledge/preview-text'
import TextProducer from '@tiggyknowledge/producer-text'
import { unzipSync } from 'fflate'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import KnowledgeOkfExport from '../src/index.ts'

function parseFrontmatter(bytes: Uint8Array): Record<string, unknown> {
  const content = new TextDecoder().decode(bytes)
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  expect(match).not.toBeNull()
  return load(match?.[1] ?? '') as Record<string, unknown>
}

describe('OKF bundle export', () => {
  it('exports a conformant portable bundle with concepts and source assets', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-okf-export-'))
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
      await ctx.plugin(KnowledgeOkfExport)

      const library = ctx.knowledgeCatalog.createLibrary({ name: '产品/规范', description: '产品知识交换包' })
      const imported = await ctx.knowledgeIngestion.ingest(library.id, [{
        name: 'guide.md',
        bytes: new TextEncoder().encode('# 使用指南\n\nExportKeyword 可交换正文'),
      }])
      const document = imported.results[0]?.document
      ctx.knowledgeMetadata.setTags(document?.id ?? '', ['产品', '规范'])

      const exported = await ctx.knowledgeOkfExport.exportLibrary(library.id)
      const files = unzipSync(exported.bytes)
      const conceptPath = `${document?.id}.md`
      const referencePath = `references/${document?.sourceAssetId}.markdown.txt`

      expect(exported.filename).toBe('产品-规范.okf.zip')
      expect(exported.validation).toEqual({ status: 'passed', okfVersion: '0.2', conceptFiles: 1, referenceFiles: 1 })
      expect(Object.keys(files).sort()).toEqual([conceptPath, 'index.md', 'log.md', referencePath].sort())
      expect(parseFrontmatter(files['index.md'] ?? new Uint8Array())).toMatchObject({ okf_version: '0.2' })
      expect(new TextDecoder().decode(files['index.md'])).toContain(`[使用指南](${conceptPath})`)
      expect(parseFrontmatter(files[conceptPath] ?? new Uint8Array())).toMatchObject({
        type: 'Concept',
        title: '使用指南',
        tags: ['产品', '规范'],
        sources: [{ resource: referencePath, content_hash: document?.contentHash }],
      })
      expect(new TextDecoder().decode(files[conceptPath])).toContain('ExportKeyword')
      expect(new TextDecoder().decode(files[referencePath])).toContain('# 使用指南')
      await expect(ctx.knowledgeOkfExport.exportLibrary('missing-library')).rejects.toThrow('知识库不存在')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('starts without knowledgeOkf so the host tree can disable OKF', async () => {
    const ctx = new Context()
    try {
      ctx.provide('knowledgeCatalog', {})
      ctx.provide('knowledgeContent', {})
      await ctx.plugin(KnowledgeOkfExport)
      expect(ctx.knowledgeOkfExport).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
