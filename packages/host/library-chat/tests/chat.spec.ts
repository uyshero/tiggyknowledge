import { Context } from '@deepseek-ai/cordis'
import type { KnowledgeDocument, LibraryChatMessage, LibraryChatSnapshot } from '@tiggyknowledge/contracts'
import type { ChatCompletionStreamInput, ToolCall } from '@tiggyknowledge/llm-client'
import { describe, expect, it, vi } from 'vitest'
import LibraryChat, { completedTurnMessages, searchQueryCandidates } from '../src/index.ts'

const endpointSettings = {
  providers: [{
    id: 'provider-1',
    name: 'Provider',
    baseUrl: 'https://llm.example/v1',
    requestTimeoutMs: 5_000,
    maxInputTokens: 4_000,
    maxOutputTokens: 500,
    models: [{ id: 'model-1', name: 'Model', model: 'model' }],
    apiKeyConfigured: true,
  }],
  preferredModelId: 'model-1',
}

function document(id: string, libraryId = 'library-a'): KnowledgeDocument {
  return {
    id,
    libraryId,
    title: `报告 ${id}`,
    originalName: `${id}.md`,
    sourceType: 'markdown',
    sourceAssetId: `asset-${id}`,
    contentHash: `hash-${id}`,
    sizeBytes: 100,
    indexStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function memoryStorage() {
  const messages: LibraryChatMessage[] = []
  const summaries = new Map<string, NonNullable<LibraryChatSnapshot['summary']>>()
  const documentSummaries = new Map<string, string>()
  return {
    snapshot: (libraryId: string): LibraryChatSnapshot => ({
      libraryId,
      messages: messages.filter(message => message.libraryId === libraryId),
      ...(summaries.has(libraryId) ? { summary: summaries.get(libraryId) } : {}),
    }),
    createTurn: ({ userMessage, assistantMessage }: { userMessage: LibraryChatMessage, assistantMessage: LibraryChatMessage }) => {
      messages.push(userMessage, assistantMessage)
    },
    getMessage: (id: string) => messages.find(message => message.id === id),
    updateMessage: (id: string, input: Partial<LibraryChatMessage> & { error?: string | null }) => {
      const index = messages.findIndex(message => message.id === id)
      const current = messages[index]
      if (current === undefined) throw new RangeError('missing')
      const next = { ...current, ...input, updatedAt: new Date().toISOString() } as LibraryChatMessage
      messages[index] = next
      return next
    },
    saveSummary: (libraryId: string, summary: NonNullable<LibraryChatSnapshot['summary']>) => summaries.set(libraryId, summary),
    getDocumentSummary: (id: string, hash: string, model: string) => {
      const summary = documentSummaries.get(`${id}:${hash}:${model}`)
      return summary === undefined ? undefined : { summary }
    },
    saveDocumentSummary: (input: { documentId: string, contentHash: string, modelId: string, summary: string }) => {
      documentSummaries.set(`${input.documentId}:${input.contentHash}:${input.modelId}`, input.summary)
    },
    deleteDocumentSummaries: vi.fn(),
    clear: (libraryId: string) => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.libraryId === libraryId) messages.splice(index, 1)
      }
    },
  }
}

function toolCall(name: string, args: Record<string, unknown> = {}, index = 1): ToolCall {
  return {
    id: `call-${index}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

function streamFor(calls: ToolCall[], answer = '最终回答 [1]') {
  return vi.fn(async function* (input: ChatCompletionStreamInput) {
    if (input.tools !== undefined && calls.length > 0) {
      yield { type: 'tool-calls' as const, toolCalls: calls }
      yield { type: 'usage' as const, inputTokens: 10, outputTokens: 2 }
      yield { type: 'finish' as const, reason: 'tool_calls' as const }
      return
    }
    yield { type: 'delta' as const, content: answer }
    yield { type: 'usage' as const, inputTokens: 20, outputTokens: 4 }
    yield { type: 'finish' as const, reason: 'stop' as const }
  })
}

async function setup(options: {
  calls: ToolCall[]
  documents?: KnowledgeDocument[]
  answer?: string
  searchResults?: Array<Record<string, unknown>>
  search?: ReturnType<typeof vi.fn>
  complete?: ReturnType<typeof vi.fn>
}) {
  const storage = memoryStorage()
  const documents = options.documents ?? [document('doc-1')]
  const stream = streamFor(options.calls, options.answer)
  const complete = options.complete ?? vi.fn(async () => ({ content: '分块摘要', inputTokens: 2, outputTokens: 1 }))
  const ctx = new Context()
  ctx.provide('chatStorage', storage)
  ctx.provide('knowledgeCatalog', {
    getLibrary: (id: string) => id === 'library-a' ? { id, name: '测试库', description: '' } : undefined,
    listDocuments: (libraryId: string) => documents.filter(item => item.libraryId === libraryId),
    getDocuments: (ids: string[]) => documents.filter(item => ids.includes(item.id)),
  })
  ctx.provide('knowledgeIndex', {
    listDocumentChunks: (id: string) => [{
      chunkId: `chunk-${id}`,
      documentId: id,
      libraryId: documents.find(item => item.id === id)?.libraryId ?? 'library-a',
      location: '第 1 节',
      title: documents.find(item => item.id === id)?.title ?? id,
      body: `正文 ${id}`,
    }],
  })
  const search = options.search ?? vi.fn(() => ({
      query: '问题',
      mode: 'keyword',
      total: options.searchResults?.length ?? 0,
      results: options.searchResults ?? [],
    }))
  ctx.provide('knowledgeQuery', { search })
  ctx.provide('llmClient', { stream, complete })
  ctx.provide('llmCredentials', { status: () => ({ configured: true }) })
  ctx.provide('settings', { llmIntegration: () => endpointSettings })
  await ctx.plugin(LibraryChat)
  return { ctx, storage, stream, complete, search }
}

describe('library chat native tool loop', () => {
  it('derives discriminating fallback queries from a full Chinese question', () => {
    const candidates = searchQueryCandidates('中国电信上半年开发推广了多少个行业 Skills？')
    expect(candidates).toContain('Skills')
    expect(candidates).toContain('开发推广')
    expect(candidates.length).toBeLessThanOrEqual(16)
    expect(candidates).not.toContain('多少')
  })

  it('builds final-answer history from complete turns plus only the active user message', () => {
    const now = '2026-01-01T00:00:00.000Z'
    const message = (
      id: string,
      role: 'user' | 'assistant',
      state: LibraryChatMessage['state'],
    ): LibraryChatMessage => ({
      id,
      libraryId: 'library-a',
      role,
      state,
      content: id,
      sources: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      createdAt: now,
      updatedAt: now,
    })
    const history = [
      message('u1', 'user', 'completed'),
      message('a1', 'assistant', 'completed'),
      message('u2', 'user', 'completed'),
      message('a2', 'assistant', 'failed'),
      message('u3', 'user', 'completed'),
      message('a3', 'assistant', 'generating'),
    ]
    expect(completedTurnMessages(history).map(item => item.id)).toEqual(['u1', 'a1', 'u3'])
  })

  it('plans with native tools then runs a protocol-correct final stream and filters cited sources', async () => {
    const searchResult = {
      chunkId: 'chunk-doc-1',
      knowledgeBaseId: 'library-a',
      documentId: 'doc-1',
      title: '报告 doc-1',
      originalName: 'doc-1.md',
      sourceType: 'markdown',
      location: '第 1 节',
      snippet: '<mark>证据</mark>',
      score: 8,
      tags: [],
      isFavorite: false,
    }
    const { ctx, stream } = await setup({
      calls: [toolCall('search_knowledge', { query: '证据' })],
      searchResults: [searchResult],
    })
    try {
      const events = []
      for await (const event of ctx.libraryChat.start('library-a', { content: '问题' })) events.push(event)
      expect(events.map(event => event.type)).toContain('routed')
      expect(events.filter(event => event.type === 'delta')).toEqual([
        expect.objectContaining({ delta: '最终回答 [1]' }),
      ])
      expect(events.at(-1)).toMatchObject({
        type: 'completed',
        message: { sources: [{ documentId: 'doc-1', citationNumber: 1 }] },
      })
      expect(stream).toHaveBeenCalledTimes(2)
      const planner = stream.mock.calls[0]?.[0]
      expect(planner.tools).toHaveLength(4)
      expect(planner.toolChoice).toBeUndefined()
      expect(planner.temperature).toBe(0)
      const final = stream.mock.calls[1]?.[0]
      expect(final.toolChoice).toBeUndefined()
      expect(final.tools).toBeUndefined()
      expect(final.messages.at(-2)).toMatchObject({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_knowledge' } }] })
      const syntheticCallId = final.messages.at(-2)?.tool_calls?.[0]?.id
      expect(syntheticCallId).toEqual(expect.any(String))
      expect(final.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: syntheticCallId })
      expect(final.messages.at(-1)?.content).toContain('"citation":"[1]"')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('completes a safe greeting deterministically without model or tools', async () => {
    const { ctx, stream } = await setup({ calls: [], answer: '你好，我是知识库助手。[1]' })
    try {
      const events = []
      for await (const event of ctx.libraryChat.start('library-a', { content: '你好' })) events.push(event)
      expect(stream).not.toHaveBeenCalled()
      expect(events.map(event => event.type)).toEqual(['started', 'delta', 'completed'])
      expect(events.some(event => event.type === 'routed')).toBe(false)
      expect(events.at(-1)).toMatchObject({
        type: 'completed',
        message: {
          content: '你好！我可以基于当前知识库检索问答，也可以总结当前文章、指定文章或整个知识库。',
          state: 'completed',
          sources: [],
        },
      })
      expect(ctx.libraryChat.snapshot('library-a').activeMessageId).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('ignores stale planner text for a knowledge question and falls back to sourced tools', async () => {
    const { ctx, storage, stream } = await setup({
      calls: [],
      searchResults: [{
        chunkId: 'chunk-doc-1',
        knowledgeBaseId: 'library-a',
        documentId: 'doc-1',
        title: '行业报告',
        originalName: 'report.md',
        sourceType: 'markdown',
        location: '行业 Skills',
        snippet: '行业 Skills 数量为 102 个',
        score: 8,
        tags: [],
        isFavorite: false,
      }],
    })
    const now = '2026-01-01T00:00:00.000Z'
    storage.createTurn({
      userMessage: {
        id: 'old-user',
        libraryId: 'library-a',
        role: 'user',
        state: 'completed',
        content: '旧问题',
        sources: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        createdAt: now,
        updatedAt: now,
      },
      assistantMessage: {
        id: 'old-assistant',
        libraryId: 'library-a',
        role: 'assistant',
        state: 'completed',
        content: '旧回答 [1][2]',
        sources: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        createdAt: now,
        updatedAt: now,
      },
    })
    stream.mockImplementation(async function* (input: ChatCompletionStreamInput) {
      if (input.tools !== undefined) {
        yield { type: 'delta' as const, content: '旧回答 [1][2]' }
        yield { type: 'finish' as const, reason: 'stop' as const }
        return
      }
      yield { type: 'delta' as const, content: '报告中的行业 Skills 数量是 102 个。[1][2]' }
      yield { type: 'finish' as const, reason: 'stop' as const }
    })
    try {
      const events = []
      for await (const event of ctx.libraryChat.start('library-a', {
        content: '报告中的行业 Skills 数量是多少？',
      })) events.push(event)
      expect(stream).toHaveBeenCalledTimes(2)
      expect(stream.mock.calls[0]?.[0].messages).toContainEqual(expect.objectContaining({
        role: 'assistant',
        content: '旧回答 [1][2]',
      }))
      expect(events.filter(event => event.type === 'delta')).toEqual([
        expect.objectContaining({ delta: '报告中的行业 Skills 数量是 102 个。[1][2]' }),
      ])
      expect(events.some(event => event.type === 'routed')).toBe(true)
      expect(events.some(event => event.type === 'sources')).toBe(true)
      expect(events.at(-1)).toMatchObject({
        type: 'completed',
        message: {
          content: '报告中的行业 Skills 数量是 102 个。[1]',
          sources: [{ documentId: 'doc-1', citationNumber: 1 }],
        },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('skips planning for an explicit command and uses an empty assistant tool content', async () => {
    const { ctx, stream } = await setup({
      calls: [],
      searchResults: [{
        chunkId: 'chunk-doc-1',
        knowledgeBaseId: 'library-a',
        documentId: 'doc-1',
        title: '报告 doc-1',
        originalName: 'doc-1.md',
        sourceType: 'markdown',
        location: '第 1 节',
        snippet: '缓存证据',
        score: 1,
        tags: [],
        isFavorite: false,
      }],
    })
    try {
      for await (const _event of ctx.libraryChat.start('library-a', { content: '/检索 缓存' })) {
        // Consume.
      }
      expect(stream).toHaveBeenCalledTimes(1)
      expect(stream.mock.calls[0]?.[0].tools).toBeUndefined()
      expect(stream.mock.calls[0]?.[0].messages.at(-2)).toMatchObject({ role: 'assistant', content: '' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('falls back to deterministic routing only when native tools are explicitly unsupported', async () => {
    const { ctx, stream, search } = await setup({
      calls: [],
      searchResults: [{
        chunkId: 'chunk-doc-1',
        knowledgeBaseId: 'library-a',
        documentId: 'doc-1',
        title: '报告 doc-1',
        originalName: 'doc-1.md',
        sourceType: 'markdown',
        location: '第 1 节',
        snippet: '回退证据',
        score: 1,
        tags: [],
        isFavorite: false,
      }],
    })
    stream.mockImplementation(async function* (input: ChatCompletionStreamInput) {
      if (input.tools !== undefined) throw new Error('LLM 请求失败（HTTP 400）：tools field is not supported')
      yield { type: 'delta' as const, content: '回退回答 [1]' }
      yield { type: 'finish' as const, reason: 'stop' as const }
    })
    try {
      const events = []
      for await (const event of ctx.libraryChat.start('library-a', { content: '缓存是什么？' })) events.push(event)
      expect(stream).toHaveBeenCalledTimes(2)
      expect(search).toHaveBeenCalled()
      expect(events.at(-1)).toMatchObject({ type: 'completed' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not turn a planner network error into deterministic fallback', async () => {
    const { ctx, stream, search } = await setup({ calls: [] })
    stream.mockImplementation(async function* () {
      throw new Error('无法连接 LLM 服务：socket closed')
    })
    try {
      const events = []
      for await (const event of ctx.libraryChat.start('library-a', { content: '缓存是什么？' })) events.push(event)
      expect(stream).toHaveBeenCalledTimes(1)
      expect(search).not.toHaveBeenCalled()
      expect(events.at(-1)).toMatchObject({ type: 'error', error: expect.stringContaining('无法连接') })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('falls back when the planner returns an unknown tool', async () => {
    const { ctx, stream, search } = await setup({
      calls: [toolCall('unknown_tool')],
      searchResults: [{
        chunkId: 'chunk-doc-1',
        knowledgeBaseId: 'library-a',
        documentId: 'doc-1',
        title: '报告 doc-1',
        originalName: 'doc-1.md',
        sourceType: 'markdown',
        location: '第 1 节',
        snippet: '证据',
        score: 1,
        tags: [],
        isFavorite: false,
      }],
    })
    try {
      for await (const _event of ctx.libraryChat.start('library-a', { content: '解释证据' })) {
        // Consume.
      }
      expect(stream).toHaveBeenCalledTimes(2)
      expect(search).toHaveBeenCalled()
      expect(stream.mock.calls[1]?.[0].messages.at(-2)).toMatchObject({
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'search_knowledge' } }],
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('executes at most four planner tool calls in model order', async () => {
    const calls = Array.from({ length: 5 }, (_, index) => toolCall('search_knowledge', { query: `词${index + 1}` }, index + 1))
    const { ctx, stream } = await setup({
      calls,
      searchResults: [{
        chunkId: 'chunk-doc-1',
        knowledgeBaseId: 'library-a',
        documentId: 'doc-1',
        title: '报告 doc-1',
        originalName: 'doc-1.md',
        sourceType: 'markdown',
        location: '第 1 节',
        snippet: '证据',
        score: 1,
        tags: [],
        isFavorite: false,
      }],
    })
    try {
      const events = []
      for await (const event of ctx.libraryChat.start('library-a', { content: '依次检索五个词' })) events.push(event)
      const finalMessages = stream.mock.calls[1]?.[0].messages
      expect(finalMessages.find(message => message.role === 'assistant' && 'tool_calls' in message)?.tool_calls).toHaveLength(4)
      expect(finalMessages.filter(message => message.role === 'tool')).toHaveLength(4)
      expect(events.filter(event => event.type === 'routed')).toHaveLength(4)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('recalls evidence through bounded fallback queries when the exact Chinese question misses', async () => {
    const fullQuestion = '中国电信上半年开发推广了多少个行业 Skills？'
    const hit = {
      chunkId: 'chunk-doc-1',
      knowledgeBaseId: 'library-a',
      documentId: 'doc-1',
      title: '中国电信能力建设报告',
      originalName: 'report.md',
      sourceType: 'markdown',
      location: '能力建设',
      snippet: '上半年开发推广了<mark>102个行业Skills</mark>',
      score: 9,
      tags: [],
      isFavorite: false,
    }
    const search = vi.fn(({ text }: { text: string }) => {
      const results = text === 'Skills' || text === '开发推广' ? [hit] : []
      return { query: text, mode: 'keyword', total: results.length, results }
    })
    const { ctx, stream } = await setup({
      calls: [toolCall('search_knowledge', { query: fullQuestion })],
      search,
      answer: '中国电信上半年开发推广了 102 个行业 Skills。[1]',
    })
    try {
      for await (const _event of ctx.libraryChat.start('library-a', { content: fullQuestion })) {
        // Consume.
      }
      const queried = search.mock.calls.map(call => call[0].text)
      expect(queried[0]).toBe(fullQuestion)
      expect(queried).toContain('Skills')
      expect(queried).toContain('开发推广')
      expect(queried.length).toBeLessThanOrEqual(17)
      const toolContent = stream.mock.calls[1]?.[0].messages.find(message => message.role === 'tool')?.content
      expect(toolContent).toContain('102个行业Skills')
      const payload = JSON.parse(toolContent ?? '{}') as { evidence?: Array<{ matchedQueries?: string[] }> }
      expect(payload.evidence?.[0]?.matchedQueries).toEqual(expect.arrayContaining(['Skills', '开发推广']))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('returns a tool error when the current document belongs to another library', async () => {
    const { ctx, stream, complete } = await setup({
      calls: [toolCall('summarize_current_document')],
      documents: [document('foreign', 'library-b')],
      answer: '请切换到正确知识库',
    })
    try {
      for await (const _event of ctx.libraryChat.start('library-a', {
        content: '总结当前文档',
        contextDocumentId: 'foreign',
      })) {
        // Consume.
      }
      expect(complete).not.toHaveBeenCalled()
      expect(stream).toHaveBeenCalledTimes(1)
      expect(ctx.libraryChat.snapshot('library-a').messages.at(-1)).toMatchObject({
        state: 'completed',
        content: expect.stringContaining('不属于'),
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('executes an exact named summary with a stable citation', async () => {
    const named = { ...document('named'), title: '指定报告' }
    const { ctx, stream, complete } = await setup({
      calls: [toolCall('summarize_named_document', { title: '指定报告' })],
      documents: [named],
      answer: '报告摘要 [1]',
    })
    try {
      const events = []
      for await (const event of ctx.libraryChat.start('library-a', {
        content: '/总结文章 指定报告 -- 结论',
      })) events.push(event)
      expect(events.filter(event => event.type === 'routed')).toMatchObject([
        { task: 'summarize-named-document' },
      ])
      expect(complete).toHaveBeenCalledTimes(2)
      expect(events.at(-1)).toMatchObject({
        type: 'completed',
        message: { sources: [{ documentId: 'named', citationNumber: 1 }] },
      })
      const protocol = stream.mock.calls[0]?.[0].messages
      expect(protocol.slice(-2)).toMatchObject([
        { role: 'assistant', tool_calls: [{ function: { arguments: '{"title":"指定报告","focus":"结论"}' } }] },
        { role: 'tool' },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('asks for clarification on ambiguous named documents without summarizing either', async () => {
    const first = { ...document('a'), title: '年度报告 2025' }
    const second = { ...document('b'), title: '年度报告 2026' }
    const { ctx, stream, complete } = await setup({
      calls: [toolCall('summarize_named_document', { title: '年度报告' })],
      documents: [first, second],
      answer: '请明确年份',
    })
    try {
      for await (const _event of ctx.libraryChat.start('library-a', { content: '总结年度报告' })) {
        // Consume.
      }
      expect(complete).not.toHaveBeenCalled()
      expect(stream).toHaveBeenCalledTimes(1)
      const result = ctx.libraryChat.snapshot('library-a').messages.at(-1)?.content
      expect(result).toContain('请明确选择')
      expect(result).toContain('年度报告 2025')
      expect(result).toContain('年度报告 2026')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('summarizes every ready library document, including more than eight', async () => {
    const documents = Array.from({ length: 9 }, (_, index) => document(`doc-${index + 1}`))
    const { ctx, complete } = await setup({
      calls: [toolCall('summarize_library')],
      documents,
      answer: '库总结 [1] [9]',
    })
    try {
      const events = []
      for await (const event of ctx.libraryChat.start('library-a', { content: '总结整个库' })) events.push(event)
      expect(complete.mock.calls.filter(call => call[0].messages[0]?.content.includes('Map 摘要'))).toHaveLength(9)
      expect(events).toContainEqual(expect.objectContaining({ type: 'progress', completed: 9, total: 10, phase: 'reduce' }))
      expect(events).toContainEqual(expect.objectContaining({ type: 'progress', completed: 10, total: 10, phase: 'reduce' }))
      expect(events.at(-1)).toMatchObject({ type: 'completed', message: { sources: [{ citationNumber: 1 }, { citationNumber: 9 }] } })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('marks a length-truncated final answer as failed instead of completed', async () => {
    const { ctx, stream } = await setup({
      calls: [toolCall('search_knowledge', { query: '证据' })],
      searchResults: [{
        chunkId: 'chunk-doc-1',
        knowledgeBaseId: 'library-a',
        documentId: 'doc-1',
        title: '报告 doc-1',
        originalName: 'doc-1.md',
        sourceType: 'markdown',
        location: '第 1 节',
        snippet: '证据',
        score: 1,
        tags: [],
        isFavorite: false,
      }],
    })
    stream.mockImplementation(async function* (input: ChatCompletionStreamInput) {
      if (input.tools !== undefined) {
        yield { type: 'tool-calls' as const, toolCalls: [toolCall('search_knowledge', { query: '证据' })] }
        yield { type: 'finish' as const, reason: 'tool_calls' as const }
        return
      }
      yield { type: 'delta' as const, content: '未完成回答' }
      yield { type: 'finish' as const, reason: 'length' as const }
    })
    try {
      const events = []
      for await (const event of ctx.libraryChat.start('library-a', { content: '问题' })) events.push(event)
      expect(events.at(-1)).toMatchObject({ type: 'error', error: expect.stringContaining('截断') })
      expect(ctx.libraryChat.snapshot('library-a').messages.at(-1)).toMatchObject({ state: 'failed' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('retries overflow with smaller valid JSON tool results', async () => {
    const searchResult = {
      chunkId: 'chunk-doc-1',
      knowledgeBaseId: 'library-a',
      documentId: 'doc-1',
      title: '报告 doc-1',
      originalName: 'doc-1.md',
      sourceType: 'markdown',
      location: '第 1 节',
      snippet: '证据'.repeat(100),
      score: 1,
      tags: [],
      isFavorite: false,
    }
    const { ctx, stream } = await setup({
      calls: [toolCall('search_knowledge', { query: '证据' })],
      searchResults: [searchResult],
    })
    let finalAttempt = 0
    const toolLengths: number[] = []
    stream.mockImplementation(async function* (input: ChatCompletionStreamInput) {
      if (input.tools !== undefined) {
        yield { type: 'tool-calls' as const, toolCalls: [toolCall('search_knowledge', { query: '证据' })] }
        yield { type: 'finish' as const, reason: 'tool_calls' as const }
        return
      }
      finalAttempt += 1
      const toolContent = input.messages.find(message => message.role === 'tool')?.content ?? ''
      expect(() => JSON.parse(toolContent)).not.toThrow()
      toolLengths.push(toolContent.length)
      if (finalAttempt === 1) throw new Error('context length exceeds maximum limit')
      yield { type: 'delta' as const, content: '回答 [1]' }
      yield { type: 'finish' as const, reason: 'stop' as const }
    })
    try {
      for await (const _event of ctx.libraryChat.start('library-a', { content: '问题' })) {
        // Consume.
      }
      expect(toolLengths).toHaveLength(2)
      expect(toolLengths[1]).toBeLessThanOrEqual(toolLengths[0] ?? 0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps a large library tool result valid and bounded without per-document summaries', async () => {
    const documents = Array.from({ length: 120 }, (_, index) => document(`doc-${index + 1}`))
    const { ctx, stream } = await setup({
      calls: [toolCall('summarize_library')],
      documents,
      complete: vi.fn(async ({ messages }: { messages: Array<{ content: string }> }) => ({
        content: messages[0]?.content.includes('Map 摘要')
          ? '文档基础摘要'.repeat(200)
          : '有界整库摘要 [1] [120]',
        inputTokens: 2,
        outputTokens: 1,
      })),
      answer: '整库回答 [1] [120]',
    })
    try {
      for await (const _event of ctx.libraryChat.start('library-a', { content: '总结整个库' })) {
        // Consume.
      }
      const toolMessage = stream.mock.calls[1]?.[0].messages.find(message => message.role === 'tool')
      expect(toolMessage?.content.length).toBeLessThan(8_000)
      const payload = JSON.parse(toolMessage?.content ?? '{}') as { sources?: Array<{ summary?: string }> }
      expect(payload.sources?.every(source => source.summary === undefined)).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps a cancelled final stream active until it exits', async () => {
    let release: (() => void) | undefined
    const entered = Promise.withResolvers<void>()
    const { ctx, stream } = await setup({
      calls: [],
      searchResults: [{
        chunkId: 'chunk-doc-1',
        knowledgeBaseId: 'library-a',
        documentId: 'doc-1',
        title: '报告 doc-1',
        originalName: 'doc-1.md',
        sourceType: 'markdown',
        location: '第 1 节',
        snippet: '证据',
        score: 1,
        tags: [],
        isFavorite: false,
      }],
    })
    stream.mockImplementation(async function* (input: ChatCompletionStreamInput) {
      if (input.tools !== undefined) {
        yield { type: 'tool-calls' as const, toolCalls: [toolCall('search_knowledge', { query: '证据' })] }
        yield { type: 'finish' as const, reason: 'tool_calls' as const }
        return
      }
      entered.resolve()
      await new Promise<void>(resolve => { release = resolve })
    })
    try {
      const iterator = ctx.libraryChat.start('library-a', { content: '问题' })[Symbol.asyncIterator]()
      await iterator.next()
      await iterator.next()
      await iterator.next()
      await iterator.next()
      await iterator.next()
      const pending = iterator.next()
      await entered.promise
      expect(ctx.libraryChat.cancel('library-a')).toMatchObject({ state: 'cancelled' })
      expect(() => ctx.libraryChat.start('library-a', { content: '另一个问题' })).toThrow('正在生成')
      release?.()
      expect(await pending).toMatchObject({ value: { type: 'cancelled' } })
      await expect(iterator.next()).resolves.toMatchObject({ done: true })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
