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
import KnowledgeSemanticCapabilities from '@tiggyknowledge/semantic-capabilities'
import { describe, expect, it } from 'vitest'
import KnowledgeQueryService from '../src/index.ts'

describe('knowledge query', () => {
  it('searches chunks, filters libraries, and rejects unavailable semantic modes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-query-'))
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
      await ctx.plugin(KnowledgeSemanticCapabilities)
      await ctx.plugin(KnowledgeQueryService)

      const product = ctx.knowledgeCatalog.createLibrary({ name: '产品库' })
      const support = ctx.knowledgeCatalog.createLibrary({ name: '支持库' })
      const productImport = await ctx.knowledgeIngestion.ingest(product.id, [{
        name: 'product.md',
        bytes: new TextEncoder().encode('# 产品规范\n\nTiggyKeyword 离线检索流程'),
      }])
      await ctx.knowledgeIngestion.ingest(support.id, [{
        name: 'support.txt',
        bytes: new TextEncoder().encode('服务手册\n\nTiggyKeyword 故障处理'),
      }])
      const productDocumentId = productImport.results[0]?.document?.id ?? ''
      ctx.knowledgeMetadata.setTags(productDocumentId, ['产品', '规范'])
      ctx.knowledgeMetadata.setFavorite(productDocumentId, true)

      const all = ctx.knowledgeQuery.search({ text: 'TiggyKeyword', knowledgeBaseIds: [] })
      expect(all.total).toBe(2)
      expect(all.results.map(result => result.location)).toContain('产品规范')
      expect(all.results.some(result => result.location === '第 1-3 行')).toBe(true)
      expect(all.results.every(result => result.snippet.includes('<mark>'))).toBe(true)
      expect(all.results.find(result => result.documentId === productDocumentId)).toMatchObject({ isFavorite: true, tags: [{ name: '产品' }, { name: '规范' }] })
      const favoriteOnly = ctx.knowledgeQuery.search({ text: 'TiggyKeyword', knowledgeBaseIds: [], favoriteOnly: true })
      expect(favoriteOnly.results).toHaveLength(1)
      expect(favoriteOnly.results[0]?.documentId).toBe(productDocumentId)

      const chinese = ctx.knowledgeQuery.search({ text: '离线检索', knowledgeBaseIds: [] })
      expect(chinese.results).toHaveLength(1)
      expect(chinese.results[0]).toMatchObject({ title: '产品规范', location: '产品规范' })
      const shortChinese = ctx.knowledgeQuery.search({ text: '离线', knowledgeBaseIds: [] })
      expect(shortChinese.results).toHaveLength(1)
      expect(shortChinese.results[0]?.snippet).toContain('<mark>离线</mark>')

      const filtered = ctx.knowledgeQuery.search({ text: 'TiggyKeyword', knowledgeBaseIds: [support.id] })
      expect(filtered.results).toHaveLength(1)
      expect(filtered.results[0]).toMatchObject({ knowledgeBaseId: support.id, originalName: 'support.txt' })
      expect(ctx.knowledgeQuery.search({ text: 'MissingKeyword', knowledgeBaseIds: [] }).results).toEqual([])
      expect(() => ctx.knowledgeQuery.search({ text: 'TiggyKeyword', knowledgeBaseIds: [], mode: 'semantic' })).toThrow('尚未安装语义检索 Provider')
      expect(() => ctx.knowledgeQuery.search({ text: 'TiggyKeyword', knowledgeBaseIds: [], mode: 'hybrid' })).toThrow('尚未安装语义检索 Provider')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
