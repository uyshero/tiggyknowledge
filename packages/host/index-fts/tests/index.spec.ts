import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import FtsIndex from '../src/index.ts'

describe('FTS document chunks', () => {
  it('lists one document in stable chunk order without crossing libraries', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-index-fts-'))
    const database = new DatabaseSync(join(dataDir, 'database.sqlite'))
    database.exec(`
      CREATE TABLE documents(id TEXT PRIMARY KEY, library_id TEXT NOT NULL);
      CREATE VIRTUAL TABLE document_fts USING fts5(document_id UNINDEXED, title, body);
      INSERT INTO documents(id, library_id) VALUES ('legacy-doc', 'library-legacy');
      INSERT INTO document_fts(document_id, title, body) VALUES ('legacy-doc', '旧文档', '旧版全文');
    `)
    database.close()

    const ctx = new Context()
    try {
      await ctx.plugin(FtsIndex, { dataDir })
      ctx.knowledgeIndex.index(
        { id: 'doc-a', libraryId: 'library-a', title: '文档 A' },
        [
          { id: 'chunk-0002-b', location: '第二节', body: '第二段' },
          { id: 'chunk-0001-a', location: '第一节', body: '第一段' },
        ],
      )
      ctx.knowledgeIndex.index(
        { id: 'doc-b', libraryId: 'library-b', title: '文档 B' },
        [{ id: 'chunk-0001-c', location: '正文', body: '不应返回' }],
      )

      expect(ctx.knowledgeIndex.listDocumentChunks('doc-a')).toEqual([
        {
          chunkId: 'chunk-0001-a',
          documentId: 'doc-a',
          libraryId: 'library-a',
          location: '第一节',
          title: '文档 A',
          body: '第一段',
        },
        {
          chunkId: 'chunk-0002-b',
          documentId: 'doc-a',
          libraryId: 'library-a',
          location: '第二节',
          title: '文档 A',
          body: '第二段',
        },
      ])
      expect(ctx.knowledgeIndex.listDocumentChunks('legacy-doc')).toEqual([{
        chunkId: 'legacy-legacy-doc',
        documentId: 'legacy-doc',
        libraryId: 'library-legacy',
        location: '全文',
        title: '旧文档',
        body: '旧版全文',
      }])
      expect(ctx.knowledgeIndex.listDocumentChunks('doc-a').every(chunk => chunk.libraryId === 'library-a')).toBe(true)
      expect(() => ctx.knowledgeIndex.listDocumentChunks('   ')).toThrow('文档 ID 无效')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
