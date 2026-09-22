import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import CatalogSqlite from '../src/index.ts'

async function withCatalog(run: (catalog: CatalogSqlite, dataDir: string) => void | Promise<void>): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-catalog-'))
  const ctx = new Context()
  try {
    const fiber = await ctx.plugin(CatalogSqlite, { dataDir })
    try {
      await run(ctx.knowledgeCatalog, dataDir)
    } finally {
      await fiber.dispose()
    }
  } finally {
    await ctx.fiber.dispose()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

describe('catalog-sqlite libraries', () => {
  it('creates normalized libraries and returns newest entries first', async () => {
    await withCatalog(async catalog => {
      const first = catalog.createLibrary({ name: ' 研发资料 ', description: ' 项目规范 ' })
      await new Promise(resolve => setTimeout(resolve, 2))
      const second = catalog.createLibrary({ name: '产品知识' })

      expect(first).toMatchObject({ name: '研发资料', description: '项目规范', kind: 'knowledge', documentCount: 0 })
      expect(catalog.listLibraries().map(item => item.id)).toEqual([second.id, first.id])
      expect(catalog.summary()).toMatchObject({ schemaVersion: 5, libraries: 2, documents: 0 })
    })
  })

  it('rejects invalid names and descriptions', async () => {
    await withCatalog(catalog => {
      expect(() => catalog.createLibrary({ name: '   ' })).toThrow('1 到 80')
      expect(() => catalog.createLibrary({ name: '知识库', description: 'x'.repeat(501) })).toThrow('500')
    })
  })

  it('updates a library without changing its identity or document count', async () => {
    await withCatalog(catalog => {
      const library = catalog.createLibrary({ name: '旧名称', description: '旧简介' })
      const updated = catalog.updateLibrary(library.id, { name: ' 新名称 ', description: ' 新简介 ' })
      expect(updated).toMatchObject({ id: library.id, name: '新名称', description: '新简介', documentCount: 0 })
      expect(catalog.getLibrary(library.id)).toMatchObject({ name: '新名称', description: '新简介' })
      expect(() => catalog.updateLibrary('missing', { name: '不存在' })).toThrow('知识库不存在')
      expect(() => catalog.updateLibrary(library.id, { name: ' ' })).toThrow('1 到 80')
    })
  })

  it('deletes a library and cascades its documents and ingestion jobs', async () => {
    await withCatalog((catalog, dataDir) => {
      const library = catalog.createLibrary({ name: '待删除知识库' })
      const document = catalog.createDocument({
        libraryId: library.id,
        title: '待删除条目',
        originalName: 'delete.txt',
        sourceType: 'text',
        sourceAssetId: 'asset-delete',
        contentHash: 'hash-delete',
        sizeBytes: 6,
      })
      catalog.createIngestionJob(library.id, 1)

      expect(catalog.deleteLibrary(library.id)).toMatchObject([{ id: document.id }])
      expect(catalog.summary()).toMatchObject({ libraries: 0, documents: 0 })
      expect(catalog.listDocuments(library.id)).toEqual([])
      const database = new DatabaseSync(join(dataDir, 'database.sqlite'))
      expect(database.prepare('SELECT count(*) AS count FROM ingestion_jobs').get()).toEqual({ count: 0 })
      database.close()
      expect(() => catalog.deleteLibrary(library.id)).toThrow('知识库不存在')
    })
  })

  it('migrates a schema v1 libraries table without losing rows', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-legacy-'))
    const database = new DatabaseSync(join(dataDir, 'database.sqlite'))
    database.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata(key, value) VALUES ('schema_version', '1');
      CREATE TABLE libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO libraries(id, name, created_at, updated_at)
      VALUES ('legacy', '旧知识库', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    database.close()

    const ctx = new Context()
    try {
      const fiber = await ctx.plugin(CatalogSqlite, { dataDir })
      try {
        expect(ctx.knowledgeCatalog.summary().schemaVersion).toBe(5)
        expect(ctx.knowledgeCatalog.listLibraries()).toMatchObject([{ id: 'legacy', name: '旧知识库', description: '', kind: 'knowledge' }])
      } finally {
        await fiber.dispose()
      }
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('hides the studio workspace from knowledge libraries and supports transfer', async () => {
    await withCatalog(catalog => {
      const knowledge = catalog.createLibrary({ name: '产品知识' })
      const studio = catalog.ensureStudioLibrary()
      expect(studio.kind).toBe('studio')
      expect(catalog.listLibraries().map(item => item.id)).toEqual([knowledge.id])
      expect(catalog.getLibrary(studio.id)).toMatchObject({ id: studio.id, kind: 'studio' })
      expect(() => catalog.deleteLibrary(studio.id)).toThrow('创作空间不能删除')
      expect(() => catalog.updateLibrary(studio.id, { name: '改名', description: '' })).toThrow('创作空间不能修改')

      const draft = catalog.createDocument({
        libraryId: studio.id,
        title: '草稿笔记',
        originalName: 'draft.md',
        sourceType: 'markdown',
        sourceAssetId: 'asset-studio',
        contentHash: 'hash-studio',
        sizeBytes: 12,
      })
      expect(catalog.summary()).toMatchObject({ libraries: 1, documents: 0 })
      expect(catalog.listDocuments(studio.id).map(item => item.id)).toEqual([draft.id])

      const moved = catalog.moveDocument(draft.id, knowledge.id)
      expect(moved).toMatchObject({ id: draft.id, libraryId: knowledge.id, indexStatus: 'pending' })
      expect(catalog.listDocuments(studio.id)).toEqual([])
      expect(catalog.listDocuments(knowledge.id).map(item => item.id)).toEqual([draft.id])
      expect(catalog.summary()).toMatchObject({ libraries: 1, documents: 1 })
    })
  })
})
