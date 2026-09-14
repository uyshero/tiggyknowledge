import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import CatalogSqlite from '@tiggyknowledge/catalog-sqlite'
import MetadataSqlite from '@tiggyknowledge/metadata-sqlite'
import { describe, expect, it } from 'vitest'
import DocumentMetadata from '../src/index.ts'

describe('document metadata', () => {
    it('manages normalized tags, favorites, rename merges, and delete cascades', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-metadata-'))
    const ctx = new Context()
    try {
      await ctx.plugin(CatalogSqlite, { dataDir })
      await ctx.plugin(MetadataSqlite, { dataDir })
      await ctx.plugin(DocumentMetadata)
      expect(ctx.knowledgeMetadataStore.schemaVersion()).toBe(1)

      const library = ctx.knowledgeCatalog.createLibrary({ name: '元数据测试库' })
      const first = ctx.knowledgeCatalog.createDocument({
        libraryId: library.id,
        title: '第一条目',
        originalName: 'first.md',
        sourceType: 'markdown',
        sourceAssetId: 'a'.repeat(64),
        contentHash: 'a'.repeat(64),
        sizeBytes: 10,
      })
      const second = ctx.knowledgeCatalog.createDocument({
        libraryId: library.id,
        title: '第二条目',
        originalName: 'second.txt',
        sourceType: 'text',
        sourceAssetId: 'b'.repeat(64),
        contentHash: 'b'.repeat(64),
        sizeBytes: 12,
      })

      const firstMetadata = ctx.knowledgeMetadata.setTags(first.id, ['Product', 'product', '规范'])
      expect(firstMetadata.tags.map(tag => tag.name)).toEqual(['Product', '规范'])
      expect(ctx.knowledgeMetadata.setFavorite(first.id, true).isFavorite).toBe(true)
      ctx.knowledgeMetadata.setTags(second.id, ['PRODUCT'])

      const tags = ctx.knowledgeMetadata.listTags()
      expect(tags).toHaveLength(2)
      const productTag = tags.find(tag => tag.name === 'Product')
      const specTag = tags.find(tag => tag.name === '规范')
      expect(productTag?.documentCount).toBe(2)
      expect(ctx.knowledgeMetadata.taggedDocuments(productTag?.id ?? '')).toHaveLength(2)
      expect(ctx.knowledgeMetadata.favoriteDocuments()).toMatchObject([{ document: { id: first.id }, metadata: { isFavorite: true } }])
      expect(() => ctx.knowledgeMetadata.setTags(first.id, Array.from({ length: 11 }, (_, index) => `标签${index}`))).toThrow('最多设置 10 个标签')
      expect(specTag).toBeDefined()
      const renamed = ctx.knowledgeMetadata.renameTag(specTag?.id ?? '', 'Product')
      expect(renamed.name).toBe('Product')
      expect(ctx.knowledgeMetadata.listTags()).toHaveLength(1)
      expect(ctx.knowledgeMetadata.taggedDocuments(renamed.id)).toHaveLength(2)

      ctx.knowledgeCatalog.deleteDocuments([first.id])
      expect(ctx.knowledgeMetadata.favoriteDocuments()).toEqual([])
      expect(ctx.knowledgeMetadata.taggedDocuments(renamed.id)).toHaveLength(1)
      ctx.knowledgeCatalog.deleteDocuments([second.id])
      expect(ctx.knowledgeMetadata.listTags()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
