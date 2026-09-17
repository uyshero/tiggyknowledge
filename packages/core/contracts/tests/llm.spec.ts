import { describe, expect, it } from 'vitest'
import {
  isLlmReady,
  resolvePreferredLlmModel,
  resolveWikiLlmModel,
  type LibraryChatStreamEvent,
  type LibraryChatTask,
  type LlmIntegrationSettings,
  type SendLibraryChatMessageInput,
} from '../src/index.ts'

const settings: LlmIntegrationSettings = {
  providers: [{
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requestTimeoutMs: 120_000,
    maxInputTokens: 32_000,
    maxOutputTokens: 4_096,
    models: [
      { id: 'mini', name: 'Mini', model: 'gpt-4.1-mini' },
      { id: 'full', name: 'Full', model: 'gpt-4.1' },
    ],
    apiKeyConfigured: true,
  }, {
    id: 'qwen',
    name: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    requestTimeoutMs: 120_000,
    maxInputTokens: 32_000,
    maxOutputTokens: 4_096,
    models: [{ id: 'plus', name: 'Plus', model: 'qwen-plus' }],
    apiKeyConfigured: true,
  }],
  preferredModelId: 'mini',
}

describe('LLM model resolution', () => {
  it('uses the preferred model for wiki generation unless a task model is set', () => {
    expect(resolvePreferredLlmModel(settings)).toMatchObject({ providerId: 'openai', modelId: 'mini', model: 'gpt-4.1-mini' })
    expect(resolveWikiLlmModel(settings)).toMatchObject({ modelId: 'mini' })
    expect(resolveWikiLlmModel({ ...settings, wikiModelId: 'plus' })).toMatchObject({
      providerId: 'qwen',
      modelId: 'plus',
      model: 'qwen-plus',
    })
    expect(isLlmReady(settings)).toBe(true)
  })

  it('falls back to the first configured model when preferred is missing', () => {
    expect(resolvePreferredLlmModel({ providers: settings.providers })?.modelId).toBe('mini')
    expect(isLlmReady({ providers: [] })).toBe(false)
  })
})

describe('library chat contracts', () => {
  it('keeps routing and progress events minimal and discriminated', () => {
    const input: SendLibraryChatMessageInput = {
      content: '总结当前文章',
      contextDocumentId: 'document-1',
      taskOverride: 'summarize-current-document',
    }
    const task: LibraryChatTask = 'summarize-current-document'
    const events: LibraryChatStreamEvent[] = [
      { type: 'routed', messageId: 'message-1', task },
      { type: 'progress', messageId: 'message-1', completed: 1, total: 3 },
    ]

    expect(input.contextDocumentId).toBe('document-1')
    expect(input.taskOverride).toBe(task)
    expect(events.map(event => event.type)).toEqual(['routed', 'progress'])
  })
})
