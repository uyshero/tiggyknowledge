import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import WikiSqlite from '../src/index.ts'

async function withStorage(run: (storage: WikiSqlite, dataDir: string) => void | Promise<void>): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-wiki-'))
  const ctx = new Context()
  try {
    const fiber = await ctx.plugin(WikiSqlite, { dataDir })
    try {
      await run(ctx.wikiStorage, dataDir)
    } finally {
      await fiber.dispose()
    }
  } finally {
    await ctx.fiber.dispose()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

describe('wiki-sqlite', () => {
  it('stores pages, sections and reverse document associations', async () => {
    await withStorage(storage => {
      storage.replaceWiki([{
        id: 'page-1',
        slug: 'overview',
        title: '总览',
        purpose: '提供知识导航。',
        questions: ['有哪些核心内容？'],
        order: 0,
        sections: [{
          id: 'section-1',
          title: '简介',
          body: '正文',
          order: 0,
          sources: [{
            documentId: 'document-1',
            libraryId: 'library-1',
            title: '来源',
            referenceUri: 'tk://local/library-1/document-1',
            contentHash: 'hash-1',
          }],
        }],
      }], [{
        documentId: 'document-1',
        libraryId: 'library-1',
        title: '来源',
        contentHash: 'hash-1',
        summary: '摘要',
      }], '2026-09-15T00:00:00.000Z')

      expect(storage.listPages()).toMatchObject([{
        id: 'page-1',
        slug: 'overview',
        purpose: '提供知识导航。',
        questions: ['有哪些核心内容？'],
      }])
      expect(storage.getPage('overview')?.sections[0]?.sources[0]).toMatchObject({ documentId: 'document-1' })
      expect(storage.pagesForDocument('document-1')).toMatchObject([{ id: 'page-1' }])
      expect(storage.cachedSummary('document-1', 'hash-1')).toBe('摘要')
    })
  })

  it('marks deleted sources without a document foreign key', async () => {
    await withStorage((storage, dataDir) => {
      storage.replaceWiki([{
        id: 'page-1',
        slug: 'overview',
        title: '总览',
        order: 0,
        sections: [{
          id: 'section-1',
          title: '简介',
          body: '正文',
          order: 0,
          sources: [{
            documentId: 'already-deleted',
            libraryId: 'library-1',
            title: '历史来源',
            referenceUri: 'tk://local/library-1/already-deleted',
            contentHash: 'old-hash',
          }],
        }],
      }], [])
      storage.markSourcesMissing(['already-deleted'])
      expect(storage.getPage('page-1')).toMatchObject({
        state: 'source-missing',
        sections: [{ state: 'source-missing', sources: [{ documentId: 'already-deleted' }] }],
      })

      const database = new DatabaseSync(join(dataDir, 'database.sqlite'))
      const foreignKeys = database.prepare("PRAGMA foreign_key_list('wiki_sources')").all() as Array<{ from: string }>
      expect(foreignKeys.some(key => key.from === 'document_id')).toBe(false)
      database.close()
    })
  })

  it('preserves page identity and supports optimistic revisions and revert', async () => {
    await withStorage(storage => {
      const source = {
        documentId: 'document-1',
        libraryId: 'library-1',
        title: '来源',
        referenceUri: 'tk://local/library-1/document-1' as const,
        contentHash: 'hash-1',
      }
      storage.replaceWiki([{
        id: 'generated-id-1',
        slug: 'concept/testing',
        title: '测试',
        summary: '初始摘要',
        pageType: 'concept',
        status: 'published',
        aliases: ['Testing'],
        order: 0,
        sections: [{ id: 'section-1', title: '简介', body: '初始正文', order: 0, sources: [source] }],
      }], [])
      storage.replaceWiki([{
        id: 'generated-id-2',
        slug: 'concept/testing',
        title: '测试主题',
        summary: '更新摘要',
        pageType: 'concept',
        status: 'published',
        aliases: ['Testing'],
        order: 0,
        sections: [{ id: 'section-2', title: '简介', body: '管道更新正文', order: 0, sources: [source] }],
      }], [])

      const generated = storage.getPage('concept/testing')
      expect(generated).toMatchObject({ id: 'generated-id-1', version: 2, lastEditSource: 'pipeline' })
      expect(storage.listRevisions('generated-id-1')).toMatchObject([{ version: 1, title: '测试' }])

      const edited = storage.updatePage({
        id: generated!.id,
        slug: generated!.slug,
        title: '人工标题',
        summary: generated!.summary,
        pageType: generated!.pageType,
        status: generated!.status,
        aliases: generated!.aliases,
        order: generated!.order,
        state: 'locked',
        sections: generated!.sections.map(section => ({ ...section, body: '人工正文' })),
      }, generated!.version)
      expect(edited).toMatchObject({ version: 3, lastEditSource: 'user', state: 'locked' })
      expect(() => storage.updatePage({
        id: edited.id,
        slug: edited.slug,
        title: '冲突写入',
        order: edited.order,
        sections: edited.sections,
      }, 2)).toThrow('已被其他操作更新')

      const reverted = storage.revertPage(edited.id, 1, edited.version)
      expect(reverted).toMatchObject({
        id: 'generated-id-1',
        title: '测试',
        version: 4,
        lastEditSource: 'revert',
      })
    })
  })

  it('persists and updates generation progress', async () => {
    await withStorage(storage => {
      storage.createGeneration({
        id: 'generation-1',
        mode: 'initial',
        state: 'pending',
        phase: 'queued',
        totalSteps: 2,
        completedSteps: 0,
        estimatedInputTokens: 100,
        inputTokens: 0,
        outputTokens: 0,
        createdAt: '2026-09-15T00:00:00.000Z',
      })
      storage.updateGeneration('generation-1', {
        state: 'running',
        phase: 'summarizing',
        completedSteps: 1,
      })
      expect(storage.activeGeneration()).toMatchObject({
        id: 'generation-1',
        state: 'running',
        completedSteps: 1,
      })
    })
  })

  it('restores and permanently removes archived pages', async () => {
    await withStorage(storage => {
      storage.replaceWiki([{
        id: 'page-trash',
        slug: 'concept/trash',
        title: '待归档',
        order: 0,
        sections: [{ id: 'section-trash', title: '正文', body: '需要保留以便恢复的正文内容。', order: 0, sources: [] }],
      }], [])
      storage.replaceWiki([], [])
      const archived = storage.listArchivedPages()[0]
      expect(archived).toMatchObject({ id: 'page-trash', status: 'archived', version: 2 })

      const restored = storage.restorePage(archived!.id, archived!.version)
      expect(restored).toMatchObject({ status: 'draft', state: 'locked', lastEditSource: 'user', version: 3 })

      storage.updatePage({
        id: restored.id,
        slug: restored.slug,
        title: restored.title,
        summary: restored.summary,
        pageType: restored.pageType,
        status: 'archived',
        aliases: restored.aliases,
        order: restored.order,
        state: restored.state,
        sections: restored.sections,
      }, restored.version)
      storage.purgeArchivedPage(restored.id)
      expect(storage.getPage(restored.id)).toBeUndefined()
    })
  })

  it('stores folders independently from pages', async () => {
    await withStorage(storage => {
      storage.replaceWiki([{
        id: 'page-in-folder',
        slug: 'concept/folder-test',
        title: '目录测试',
        folderId: 'folder-child',
        order: 0,
        sections: [{ id: 'section-folder', title: '正文', body: '独立目录中的页面正文。', order: 0, sources: [] }],
      }], [], '2026-09-16T00:00:00.000Z', [
        { id: 'folder-root', name: '产品', path: '产品', depth: 0, order: 0 },
        { id: 'folder-child', name: '设计', path: '产品/设计', parentId: 'folder-root', depth: 1, order: 1 },
      ])
      expect(storage.listFolders()).toMatchObject([
        { id: 'folder-root', name: '产品', depth: 0 },
        { id: 'folder-child', name: '设计', parentId: 'folder-root', depth: 1 },
      ])
      expect(storage.getPage('concept/folder-test')).toMatchObject({ folderId: 'folder-child' })
    })
  })

  it('derives forward and reverse wiki links from page content', async () => {
    await withStorage(storage => {
      storage.replaceWiki([
        {
          id: 'page-a',
          slug: 'concept/a',
          title: '页面 A',
          order: 0,
          sections: [{ id: 'section-a', title: '正文', body: '参见 [[concept/b|页面 B]]。', order: 0, sources: [] }],
        },
        {
          id: 'page-b',
          slug: 'concept/b',
          title: '页面 B',
          order: 1,
          sections: [{ id: 'section-b', title: '正文', body: '被其他页面引用。', order: 0, sources: [] }],
        },
      ], [])
      expect(storage.getPage('concept/a')).toMatchObject({ outLinks: ['concept/b'], inLinks: [] })
      expect(storage.getPage('concept/b')).toMatchObject({ outLinks: [], inLinks: ['concept/a'] })
    })
  })

  it('skips inbox items until the document hash changes and unlocks locked pages', async () => {
    await withStorage(storage => {
      storage.replaceWiki([{
        id: 'page-locked',
        slug: 'topic/locked',
        title: '锁定词条',
        order: 0,
        state: 'locked',
        sections: [{ id: 'section-locked', title: '正文', body: '已人工修订的正文。', order: 0, sources: [] }],
      }], [{
        documentId: 'document-1',
        libraryId: 'library-1',
        title: '来源',
        contentHash: 'hash-1',
      }])
      storage.skipInboxItem('document-2', 'hash-2')
      expect(storage.isInboxSkipped('document-2', 'hash-2')).toBe(true)
      expect(storage.isInboxSkipped('document-2', 'hash-3')).toBe(false)
      expect(storage.listInboxSkips()).toEqual([expect.objectContaining({
        documentId: 'document-2',
        contentHash: 'hash-2',
        skippedAt: expect.any(String),
      })])
      storage.unskipInboxItem('document-2')
      expect(storage.isInboxSkipped('document-2', 'hash-2')).toBe(false)
      expect(storage.listInboxSkips()).toEqual([])
      storage.skipInboxItem('document-2', 'hash-2')
      const unlocked = storage.unlockPage('page-locked', 1)
      expect(unlocked).toMatchObject({ id: 'page-locked', state: 'ready', version: 2 })
      storage.replaceWiki([{
        id: 'page-draft',
        slug: 'topic/draft',
        title: '待核词条',
        status: 'draft',
        order: 0,
        sections: [{ id: 'section-draft', title: '正文', body: '待核对的正文。', order: 0, sources: [] }],
      }], [])
      expect(storage.publishPage('page-draft', 1)).toMatchObject({ status: 'published', version: 2 })
    })
  })
})
