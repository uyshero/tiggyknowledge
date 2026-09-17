import { describe, expect, it } from 'vitest'
import type { LibraryChatMessage, SystemSnapshot } from '@tiggyknowledge/contracts'
import {
  applyChatSnapshotEvent,
  applyChatStreamEvent,
  applyChatToolEvent,
  canApplyChatReconciliation,
  chatTaskLabel,
  createChatSendInput,
  documentsState,
  hasExpectedTerminalMessage,
  isCurrentChatGeneration,
  isLibraryChatSettled,
  preferredChatModel,
  shouldApplyPersistedChatSnapshot,
} from '../src/index.tsx'

const assistant: LibraryChatMessage = {
  id: 'assistant-1',
  libraryId: 'library-1',
  role: 'assistant',
  state: 'generating',
  content: '',
  sources: [],
  tokenUsage: { inputTokens: 0, outputTokens: 0 },
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
}

describe('library chat UI state', () => {
  it('parses library and document ids from document page state', () => {
    expect(documentsState({ libraryId: 'library-1', documentId: 'document-1', location: '2' })).toEqual({
      libraryId: 'library-1',
      documentId: 'document-1',
    })
    expect(documentsState({ libraryId: 1, documentId: false })).toEqual({})
    expect(documentsState(null)).toEqual({})
  })

  it('creates send input with the document captured at send time', () => {
    expect(createChatSendInput('问题', 'model-1', 'document-2')).toEqual({
      content: '问题',
      modelId: 'model-1',
      contextDocumentId: 'document-2',
    })
    expect(createChatSendInput('问题', 'model-1', undefined)).toEqual({
      content: '问题',
      modelId: 'model-1',
    })
  })

  it('labels routed tasks in Chinese', () => {
    expect(chatTaskLabel('retrieval')).toBe('检索知识')
    expect(chatTaskLabel('summarize-current-document')).toBe('总结当前文章')
    expect(chatTaskLabel('summarize-named-document')).toBe('总结指定文章')
    expect(chatTaskLabel('summarize-library')).toBe('总结整个知识库')
  })

  it('tracks routed progress without changing messages or marking failure', () => {
    const routed = { type: 'routed', messageId: assistant.id, task: 'summarize-library' } as const
    const progress = {
      type: 'progress',
      messageId: assistant.id,
      completed: 2,
      total: 5,
      phase: 'summarizing',
      message: '正在总结第 2 篇',
    } as const
    const activity = applyChatToolEvent(applyChatToolEvent(undefined, routed), progress)
    expect(activity).toEqual({
      task: 'summarize-library',
      completed: 2,
      total: 5,
      phase: 'summarizing',
      message: '正在总结第 2 篇',
    })
    expect(applyChatStreamEvent([assistant], progress)).toEqual([assistant])
    expect(applyChatStreamEvent([assistant], progress)[0]?.state).toBe('generating')
    expect(applyChatToolEvent(activity, { type: 'completed', message: { ...assistant, state: 'completed' } })).toBeUndefined()
  })

  it('appends deltas and applies terminal messages', () => {
    const streaming = applyChatStreamEvent([assistant], { type: 'delta', messageId: assistant.id, delta: '答案' })
    expect(streaming[0]?.content).toBe('答案')
    const completed = applyChatStreamEvent(streaming, {
      type: 'completed',
      message: { ...assistant, state: 'completed', content: '完整答案' },
    })
    expect(completed[0]).toMatchObject({ state: 'completed', content: '完整答案' })
  })

  it('keeps the active message through intermediate events and clears it at terminal state', () => {
    const started = applyChatSnapshotEvent(undefined, 'library-1', {
      type: 'started',
      userMessage: { ...assistant, id: 'user-1', role: 'user', state: 'completed', content: '问题' },
      assistantMessage: assistant,
    })
    expect(started.activeMessageId).toBe(assistant.id)
    const streaming = applyChatSnapshotEvent(started, 'library-1', {
      type: 'delta',
      messageId: assistant.id,
      delta: '部分',
    })
    expect(streaming.activeMessageId).toBe(assistant.id)
    const completed = applyChatSnapshotEvent(streaming, 'library-1', {
      type: 'completed',
      message: { ...assistant, state: 'completed', content: '完成' },
    })
    expect(completed.activeMessageId).toBeUndefined()
  })

  it('prefers remembered, configured preferred, then first model', () => {
    const choices = [
      { id: 'first', providerId: 'p', providerName: 'P', model: 'm1', name: 'M1', label: 'P / M1', apiKeyConfigured: true },
      { id: 'preferred', providerId: 'p', providerName: 'P', model: 'm2', name: 'M2', label: 'P / M2', apiKeyConfigured: true },
    ]
    const system = { llm: { providers: [], preferredModelId: 'preferred' } } as unknown as SystemSnapshot
    expect(preferredChatModel(system, choices, 'first')).toBe('first')
    expect(preferredChatModel(system, choices)).toBe('preferred')
    expect(preferredChatModel(undefined, choices)).toBe('first')
  })

  it('rejects stale generations and events captured for another library', () => {
    const current = { generation: 3, libraryId: 'library-b' }
    expect(isCurrentChatGeneration(current, current, 'library-b')).toBe(true)
    expect(isCurrentChatGeneration(current, { generation: 2, libraryId: 'library-b' }, 'library-b')).toBe(false)
    expect(isCurrentChatGeneration(current, { generation: 3, libraryId: 'library-a' }, 'library-b')).toBe(false)
    expect(isCurrentChatGeneration(current, current, 'library-a')).toBe(false)
    const persisted = {
      libraryId: 'library-b',
      messages: [{ ...assistant, libraryId: 'library-b', state: 'completed' as const }],
    }
    expect(canApplyChatReconciliation(current, current, 'library-b', persisted)).toBe(true)
    expect(canApplyChatReconciliation(current, { generation: 2, libraryId: 'library-b' }, 'library-b', persisted)).toBe(false)
    expect(canApplyChatReconciliation(current, current, 'library-a', persisted)).toBe(false)
  })

  it('recognizes persisted terminal snapshots for stalled stream recovery', () => {
    const completedSnapshot = {
      libraryId: 'library-1',
      messages: [{ ...assistant, state: 'completed' as const, content: '从持久化快照恢复的终态' }],
    }
    expect(isLibraryChatSettled({
      libraryId: 'library-1',
      messages: [{ ...assistant, state: 'completed', content: '完成' }],
    })).toBe(true)
    expect(isLibraryChatSettled({
      libraryId: 'library-1',
      messages: [assistant],
      activeMessageId: assistant.id,
    })).toBe(false)
    expect(hasExpectedTerminalMessage({
      libraryId: 'library-1',
      messages: [{ ...assistant, id: 'old-assistant', state: 'completed' }],
    }, assistant.id)).toBe(false)
    expect(hasExpectedTerminalMessage({
      libraryId: 'library-1',
      messages: [{ ...assistant, state: 'cancelled' }],
    }, assistant.id)).toBe(true)
    expect(hasExpectedTerminalMessage({
      libraryId: 'library-1',
      messages: completedSnapshot.messages,
    }, assistant.id)).toBe(true)
    expect(shouldApplyPersistedChatSnapshot(completedSnapshot, assistant.id, false)).toBe(true)
    expect(shouldApplyPersistedChatSnapshot({
      libraryId: 'library-1',
      messages: [assistant],
      activeMessageId: assistant.id,
    }, assistant.id, true)).toBe(false)
  })
})
