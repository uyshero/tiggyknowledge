import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { LibraryChatMessage } from '@tiggyknowledge/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import ChatSqlite from '../src/index.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function message(id: string, libraryId: string, role: 'user' | 'assistant', state: LibraryChatMessage['state']): LibraryChatMessage {
  return {
    id,
    libraryId,
    role,
    state,
    content: role === 'user' ? '问题' : '',
    ...(role === 'assistant' ? { modelId: 'model-1' } : {}),
    sources: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    createdAt: `2026-01-01T00:00:0${id === 'u1' ? '0' : '1'}.000Z`,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('chat sqlite storage', () => {
  it('isolates timelines and persists summary, sources, usage and terminal state', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggy-chat-'))
    directories.push(dataDir)
    const ctx = new Context()
    try {
      await ctx.plugin(ChatSqlite, { dataDir })
      ctx.chatStorage.createTurn({
        libraryId: 'library-a',
        userMessage: message('u1', 'library-a', 'user', 'completed'),
        assistantMessage: message('a1', 'library-a', 'assistant', 'generating'),
      })
      ctx.chatStorage.updateMessage('a1', {
        content: '回答',
        state: 'completed',
        sources: [{
          documentId: 'doc-1',
          libraryId: 'library-a',
          title: '文档',
          referenceUri: 'tk://local/library-a/doc-1',
          location: 'chunk-1',
          snippet: '内容',
          score: 4,
        }],
        tokenUsage: { inputTokens: 10, outputTokens: 2 },
      })
      ctx.chatStorage.saveSummary('library-a', {
        content: '摘要',
        cutoffMessageId: 'a1',
        updatedAt: '2026-01-01T00:00:02.000Z',
      })
      expect(ctx.chatStorage.snapshot('library-a')).toMatchObject({
        messages: [{ id: 'u1' }, { id: 'a1', state: 'completed', content: '回答', tokenUsage: { inputTokens: 10, outputTokens: 2 } }],
        summary: { content: '摘要', cutoffMessageId: 'a1' },
      })
      expect(ctx.chatStorage.snapshot('library-b').messages).toEqual([])
      ctx.chatStorage.clear('library-a')
      expect(ctx.chatStorage.snapshot('library-a')).toEqual({ libraryId: 'library-a', messages: [] })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('marks interrupted generations failed on startup', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggy-chat-'))
    directories.push(dataDir)
    const first = new Context()
    await first.plugin(ChatSqlite, { dataDir })
    first.chatStorage.createTurn({
      libraryId: 'library-a',
      userMessage: message('u1', 'library-a', 'user', 'completed'),
      assistantMessage: message('a1', 'library-a', 'assistant', 'generating'),
    })
    await first.fiber.dispose()

    const second = new Context()
    try {
      await second.plugin(ChatSqlite, { dataDir })
      expect(second.chatStorage.getMessage('a1')).toMatchObject({ state: 'failed', error: expect.stringContaining('重启') })
    } finally {
      await second.fiber.dispose()
    }
  })

  it('persists document summaries and isolates content hashes and models', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggy-chat-'))
    directories.push(dataDir)
    const first = new Context()
    await first.plugin(ChatSqlite, { dataDir })
    first.chatStorage.saveDocumentSummary({
      documentId: 'doc-1',
      contentHash: 'hash-1',
      modelId: 'model-1',
      summary: '持久摘要',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(first.chatStorage.getDocumentSummary('doc-1', 'hash-1', 'model-1')).toMatchObject({
      summary: '持久摘要',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(first.chatStorage.getDocumentSummary('doc-1', 'hash-2', 'model-1')).toBeUndefined()
    expect(first.chatStorage.getDocumentSummary('doc-1', 'hash-1', 'model-2')).toBeUndefined()
    await first.fiber.dispose()

    const second = new Context()
    try {
      await second.plugin(ChatSqlite, { dataDir })
      expect(second.chatStorage.getDocumentSummary('doc-1', 'hash-1', 'model-1')?.summary).toBe('持久摘要')
      second.chatStorage.deleteDocumentSummaries('doc-1')
      expect(second.chatStorage.getDocumentSummary('doc-1', 'hash-1', 'model-1')).toBeUndefined()
    } finally {
      await second.fiber.dispose()
    }
  })
})
