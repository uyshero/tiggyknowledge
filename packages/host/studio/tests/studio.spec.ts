import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import CatalogSqlite from '@tiggyknowledge/catalog-sqlite'
import BasicChunker from '@tiggyknowledge/chunker-basic'
import ContentLocal from '@tiggyknowledge/content-local'
import FtsIndex from '@tiggyknowledge/index-fts'
import { describe, expect, it } from 'vitest'
import KnowledgeStudio from '../src/index.ts'

describe('knowledge studio', () => {
  it('keeps drafts out of knowledge search until they are transferred', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-studio-'))
    const ctx = new Context()
    try {
      await ctx.plugin(CatalogSqlite, { dataDir })
      await ctx.plugin(ContentLocal, { dataDir })
      await ctx.plugin(BasicChunker)
      await ctx.plugin(FtsIndex, { dataDir })
      ctx.provide('llmClient', {
        transcribe: async () => ({ text: '这是自动转写的内容。' }),
      })
      ctx.provide('llmCredentials', {
        status: () => ({ configured: true, preview: 'sk-****' }),
        getApiKey: () => 'sk-test-key',
      })
      const llm = {
        providers: [{
          id: 'test-provider',
          name: '测试',
          baseUrl: 'http://127.0.0.1:9/v1',
          requestTimeoutMs: 1000,
          maxInputTokens: 1000,
          maxOutputTokens: 100,
          models: [
            { id: 'chat', name: 'chat', model: 'gpt-test' },
            { id: 'whisper', name: 'whisper', model: 'whisper-1' },
          ],
          apiKeyConfigured: true,
        }],
        preferredModelId: 'chat',
        transcriptionModelId: 'whisper' as string | undefined,
      }
      ctx.provide('settings', {
        llmIntegration: () => llm,
      })
      await ctx.plugin(KnowledgeStudio)

      const knowledge = ctx.knowledgeCatalog.createLibrary({ name: '产品知识' })
      expect(ctx.knowledgeCatalog.listLibraries().map(item => item.id)).toEqual([knowledge.id])

      const note = ctx.knowledgeStudio.createNote({ title: '草稿笔记', body: 'StudioKeyword 不应被检索' })
      expect(note.sourceType).toBe('markdown')
      expect(note.category).toBe('未分类')
      const emptyNote = ctx.knowledgeStudio.createNote({ title: '只有标题', body: '', category: '会议' })
      expect(emptyNote.title).toBe('只有标题')
      expect(emptyNote.category).toBe('会议')
      const recategorized = ctx.knowledgeStudio.updateNote(emptyNote.id, { title: '只有标题', body: '', category: '产品' })
      expect(recategorized.category).toBe('产品')
      expect(recategorized.title).toBe('只有标题')
      expect(ctx.knowledgeCatalog.listLibraries().flatMap(library => ctx.knowledgeCatalog.listDocuments(library.id))).toEqual([])
      expect(ctx.knowledgeIndex.search({ text: 'StudioKeyword', libraryIds: [], limit: 10 })).toEqual([])

      const recording = ctx.knowledgeStudio.createRecording({
        title: '会议录音',
        mimeType: 'audio/webm',
        audioBase64: Buffer.from('fake-audio').toString('base64'),
        transcript: '',
        category: '会议',
      })
      expect(recording.category).toBe('会议')
      expect(ctx.knowledgeStudio.workspace().transcriptionReady).toBe(true)
      const transcribed = await ctx.knowledgeStudio.transcribe(recording.id)
      expect(transcribed.transcript).toBe('这是自动转写的内容。')
      expect(transcribed.category).toBe('会议')
      llm.transcriptionModelId = undefined
      expect(ctx.knowledgeStudio.workspace().transcriptionReady).toBe(false)
      await expect(ctx.knowledgeStudio.transcribe(recording.id)).rejects.toThrow('尚未配置语音转写模型')
      llm.transcriptionModelId = 'whisper'

      const movedNote = ctx.knowledgeStudio.transfer(note.id, { libraryId: knowledge.id })
      expect(movedNote.libraryId).toBe(knowledge.id)
      expect(movedNote.indexStatus).toBe('ready')
      expect(ctx.knowledgeIndex.search({ text: 'StudioKeyword', libraryIds: [knowledge.id], limit: 10 })).toHaveLength(1)
      expect(ctx.knowledgeStudio.workspace().items.map(item => item.id).sort()).toEqual([emptyNote.id, transcribed.id].sort())
      expect(ctx.knowledgeStudio.workspace().categories).toEqual(['产品', '会议', '未分类'])

      const createdCategory = ctx.knowledgeStudio.createCategory({ name: '灵感' })
      expect(createdCategory.categories).toEqual(['产品', '会议', '灵感', '未分类'])
      expect(() => ctx.knowledgeStudio.createCategory({ name: '灵感' })).toThrow('分类已存在')
      const renamed = ctx.knowledgeStudio.renameCategory({ from: '产品', name: '周会' })
      expect(renamed.categories).toEqual(['会议', '灵感', '周会', '未分类'])
      expect(renamed.items.find(item => item.id === emptyNote.id)?.category).toBe('周会')
      expect(() => ctx.knowledgeStudio.deleteCategory({ name: '未分类' })).toThrow('默认分类不能删除')
      const deleted = ctx.knowledgeStudio.deleteCategory({ name: '周会' })
      expect(deleted.categories).toEqual(['会议', '灵感', '未分类'])
      expect(deleted.items.find(item => item.id === emptyNote.id)?.category).toBe('未分类')
      const emptyFolder = ctx.knowledgeStudio.createCategory({ name: '待整理' })
      expect(emptyFolder.categories).toContain('待整理')
      expect(ctx.knowledgeStudio.deleteCategory({ name: '待整理' }).categories).toEqual(['会议', '灵感', '未分类'])
      expect(() => ctx.knowledgeStudio.deleteCategory({ name: '没有这个' })).toThrow('分类不存在')

      const pictured = ctx.knowledgeStudio.attachNoteImage(emptyNote.id, {
        mimeType: 'image/png',
        name: '示意图',
        imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      })
      expect(pictured.document.sourceType).toBe('markdown')
      expect(pictured.markdown).toBe(`![示意图](/api/documents/${emptyNote.id}/images/${pictured.image.id})`)
      expect(ctx.knowledgeCatalog.getDocuments([emptyNote.id])[0]?.images).toEqual([pictured.image])
      const afterEdit = ctx.knowledgeStudio.updateNote(emptyNote.id, {
        title: '只有标题',
        body: pictured.markdown,
        category: '周会',
      })
      expect(afterEdit.images).toEqual([pictured.image])
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
