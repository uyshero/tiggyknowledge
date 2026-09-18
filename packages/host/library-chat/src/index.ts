import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {} from '@tiggyknowledge/chat-sqlite'
import type {
  KnowledgeDocument,
  KnowledgeSearchResult,
  LibraryChatMessage,
  LibraryChatSnapshot,
  LibraryChatSource,
  LibraryChatStreamEvent,
  LibraryChatTokenUsage,
  LlmResolvedEndpoint,
  SendLibraryChatMessageInput,
} from '@tiggyknowledge/contracts'
import { resolveLlmModel, resolvePreferredLlmModel } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/index-fts'
import type { ChatCompletionStreamEvent, ChatMessage, ToolCall } from '@tiggyknowledge/llm-client'
import type {} from '@tiggyknowledge/llm-client'
import type {} from '@tiggyknowledge/llm-credentials'
import type {} from '@tiggyknowledge/query'
import type {} from '@tiggyknowledge/settings-file'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'
import { libraryChatHttpRoutes } from './http.ts'
import {
  isSafeDirectChat,
  LibraryChatRouteClarification,
  parseLibraryChatRoute,
  routeLibraryChatMessage,
  type RoutedLibraryChatMessage,
} from './router.js'
import { reduceSummaries, summarizeDocument } from './summarize.js'
import {
  LIBRARY_CHAT_TOOLS,
  parseToolCall,
  taskForTool,
  type LibraryToolArguments,
} from './tools.js'

export {
  isSafeDirectChat,
  LibraryChatRouteClarification,
  parseLibraryChatRoute,
  routeLibraryChatMessage,
  type ParsedLibraryChatRoute,
  type RouteLibraryChatInput,
  type RoutedLibraryChatMessage,
} from './router.js'
export { libraryChatHttpRoutes, type LibraryChatHttpHost } from './http.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    libraryChat: LibraryChat
  }
}

interface ActiveGeneration {
  controller: AbortController
  assistantMessageId: string
}

interface ToolExecutionProgress {
  type: 'progress'
  completed: number
  total: number
  phase: string
  message: string
}

interface ToolExecutionResult {
  type: 'result'
  content: string
  ok: boolean
}

type ToolExecutionEvent = ToolExecutionProgress | ToolExecutionResult

const SEARCH_TOP_K = 8
const SEARCH_FALLBACK_TOP_K = 3
const MAX_SEARCH_CANDIDATES = 16
const RECENT_MESSAGE_COUNT = 6
const SUMMARY_PRESSURE = 0.7
const TOOL_RESULT_TOKEN_RESERVE = 256
const SAFE_DIRECT_CHAT_RESPONSE = '你好！我可以基于当前知识库检索问答，也可以总结当前文章、指定文章或整个知识库。'

export class LibraryChat extends Service {
  static inject = [
    'chatStorage',
    'knowledgeCatalog',
    'knowledgeIndex',
    'knowledgeQuery',
    'llmClient',
    'llmCredentials',
    'settings',
  ]

  private readonly active = new Map<string, ActiveGeneration>()

  constructor(ctx: Context) {
    super(ctx, 'libraryChat')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-library-chat',
        moduleName: '@tiggyknowledge/client-library-chat',
        label: 'Library Chat',
        description: 'Knowledge library grounded question answering',
      }],
      routes: libraryChatHttpRoutes(this),
    })
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    const disposeDeleted = this.ctx.on('knowledge/library/deleted', libraryId => {
      this.active.get(libraryId)?.controller.abort()
      this.ctx.chatStorage.clear(libraryId)
    })
    const disposeDocuments = this.ctx.on('knowledge/document/deleted', documentIds => {
      for (const documentId of documentIds) this.ctx.chatStorage.deleteDocumentSummaries(documentId)
    })
    const disposeChanged = this.ctx.on('knowledge/document/changed', documentIds => {
      for (const documentId of documentIds) this.ctx.chatStorage.deleteDocumentSummaries(documentId)
    })
    yield () => {
      disposeDeleted()
      disposeDocuments()
      disposeChanged()
      for (const generation of this.active.values()) generation.controller.abort()
      this.active.clear()
    }
  }

  snapshot(libraryId: string): LibraryChatSnapshot {
    this.validateLibrary(libraryId)
    const snapshot = this.ctx.chatStorage.snapshot(libraryId)
    return {
      ...snapshot,
      messages: snapshot.messages.map(message => (
        message.role === 'assistant' && message.state === 'completed'
          ? { ...message, sources: citedSources(message.content, message.sources) }
          : message
      )),
    }
  }

  start(libraryId: string, input: SendLibraryChatMessageInput): AsyncIterable<LibraryChatStreamEvent> {
    this.validateLibrary(libraryId)
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    if (content.length < 1 || content.length > 20_000) throw new RangeError('聊天消息长度应为 1 到 20000 个字符')
    if (this.active.has(libraryId)) throw new RangeError('该知识库已有回答正在生成')
    const direct = input.taskOverride === undefined && isSafeDirectChat(content)
    const endpoint = direct ? undefined : this.resolveEndpoint(input.modelId)
    const now = new Date().toISOString()
    const userMessage = createMessage(libraryId, 'user', 'completed', content, now)
    const assistantMessage = createMessage(libraryId, 'assistant', 'generating', '', now, endpoint?.modelId)
    this.ctx.chatStorage.createTurn({ libraryId, userMessage, assistantMessage })
    const controller = new AbortController()
    this.active.set(libraryId, { controller, assistantMessageId: assistantMessage.id })
    return this.generate(libraryId, input, endpoint, direct, userMessage, assistantMessage, controller)
  }

  cancel(libraryId: string): LibraryChatMessage | undefined {
    this.validateLibrary(libraryId)
    const generation = this.active.get(libraryId)
    if (generation === undefined) return undefined
    generation.controller.abort()
    const current = this.ctx.chatStorage.getMessage(generation.assistantMessageId)
    if (current === undefined || current.state !== 'generating') return current
    return this.ctx.chatStorage.updateMessage(current.id, { state: 'cancelled' })
  }

  clear(libraryId: string): void {
    this.validateLibrary(libraryId)
    this.cancel(libraryId)
    this.ctx.chatStorage.clear(libraryId)
  }

  private async *generate(
    libraryId: string,
    input: SendLibraryChatMessageInput,
    endpoint: LlmResolvedEndpoint | undefined,
    direct: boolean,
    userMessage: LibraryChatMessage,
    assistantMessage: LibraryChatMessage,
    controller: AbortController,
  ): AsyncGenerator<LibraryChatStreamEvent> {
    let terminal = false
    let content = ''
    let usage: LibraryChatTokenUsage = { inputTokens: 0, outputTokens: 0 }
    const sources: LibraryChatSource[] = []
    const sourceNumbers = new Map<string, number>()
    try {
      yield { type: 'started', userMessage, assistantMessage }
      if (direct) {
        content = SAFE_DIRECT_CHAT_RESPONSE
        this.ctx.chatStorage.updateMessage(assistantMessage.id, { content })
        yield { type: 'delta', messageId: assistantMessage.id, delta: content }
        const message = this.ctx.chatStorage.updateMessage(assistantMessage.id, {
          content,
          state: 'completed',
          sources: [],
          tokenUsage: usage,
        })
        terminal = true
        yield { type: 'completed', message }
        return
      }
      if (endpoint === undefined) throw new Error('聊天模型配置缺失')
      const documents = this.ctx.knowledgeCatalog.listDocuments(libraryId)
      const parsedRoute = parseLibraryChatRoute({ ...input, documents })
      let calls: ToolCall[] = []
      let tools: LibraryToolArguments[] = []
      let protocolMessages: ChatMessage[]
      try {
        if (parsedRoute.forced) {
          const routed = parsedRoute.route
          if (routed === undefined) throw new Error('强制路由缺少工具')
          calls = [syntheticToolCall(routed)]
          tools = [routedToolArguments(routed)]
          protocolMessages = [
            ...await this.buildBaseMessages(libraryId, input, endpoint, false, 'final'),
            { role: 'assistant', content: '', tool_calls: calls },
          ]
        } else {
          const plannerMessages = await this.buildBaseMessages(libraryId, input, endpoint, false, 'planner')
          let plannerContent = ''
          let plannerCalls: ToolCall[] = []
          let plannerFinishReason: string | undefined
          try {
            for await (const event of this.ctx.llmClient.stream({
              settings: endpoint,
              messages: plannerMessages,
              tools: LIBRARY_CHAT_TOOLS,
              signal: controller.signal,
              temperature: 0,
            })) {
              throwIfAborted(controller.signal)
              if (event.type === 'delta') {
                plannerContent += event.content
              } else if (event.type === 'tool-calls') {
                plannerCalls = event.toolCalls
              } else if (event.type === 'usage') {
                usage = addUsage(usage, streamUsage(event))
                yield { type: 'usage', messageId: assistantMessage.id, usage }
              } else if (event.type === 'finish') {
                plannerFinishReason = event.reason
              }
            }
            validateStreamFinish(plannerFinishReason, '工具决策')
            if (plannerCalls.length === 0) {
              if (plannerContent.trim().length === 0) throw new Error('LLM 工具决策响应缺少文本或工具调用')
              const fallback = routeLibraryChatMessage({ ...input, documents })
              calls = [syntheticToolCall(fallback)]
              tools = [routedToolArguments(fallback)]
              protocolMessages = [
                ...await this.buildBaseMessages(libraryId, input, endpoint, false, 'final'),
                { role: 'assistant', content: '', tool_calls: calls },
              ]
            } else {
              const parsedTools = plannerCalls.map(parseToolCall)
              calls = plannerCalls.slice(0, 4)
              tools = parsedTools.slice(0, 4)
              protocolMessages = [
                ...plannerMessages,
                { role: 'assistant', content: '', tool_calls: calls },
              ]
            }
          } catch (error) {
            if (!isUnsupportedNativeTools(error) && !isInvalidToolCall(error)) throw error
            const fallback = routeLibraryChatMessage({ ...input, documents })
            calls = [syntheticToolCall(fallback)]
            tools = [routedToolArguments(fallback)]
            protocolMessages = [
              ...await this.buildBaseMessages(libraryId, input, endpoint, false, 'final'),
              { role: 'assistant', content: '', tool_calls: calls },
            ]
          }
        }
      } catch (error) {
        if (!(error instanceof LibraryChatRouteClarification)) throw error
        yield { type: 'routed', messageId: assistantMessage.id, task: error.task }
        content = error.message
        this.ctx.chatStorage.updateMessage(assistantMessage.id, { content })
        yield { type: 'delta', messageId: assistantMessage.id, delta: content }
        const message = this.ctx.chatStorage.updateMessage(assistantMessage.id, {
          content,
          state: 'completed',
          sources: [],
          tokenUsage: usage,
        })
        terminal = true
        yield { type: 'completed', message }
        return
      }
      const toolBudget = createToolResultBudget(endpoint, protocolMessages)
      const toolOutcomes: ToolExecutionResult[] = []
      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index]
        const tool = tools[index]
        if (call === undefined || tool === undefined) continue
        yield { type: 'routed', messageId: assistantMessage.id, task: taskForTool(tool.name) }
        throwIfAborted(controller.signal)
        let toolContent: string
        let toolOk = false
        try {
          let result: ToolExecutionResult | undefined
          const maximumResultCharacters = Math.max(128, toolBudget.remainingTokens * 3)
          for await (const event of this.executeTool(
            libraryId,
            input,
            endpoint,
            tool,
            sources,
            sourceNumbers,
            controller.signal,
            maximumResultCharacters,
          )) {
            if (event.type === 'progress') {
              yield {
                type: 'progress',
                messageId: assistantMessage.id,
                completed: event.completed,
                total: event.total,
                phase: event.phase,
                message: event.message,
              }
            } else {
              result = event
            }
          }
          toolContent = result?.content ?? JSON.stringify({ ok: false, error: '工具没有返回结果' })
          toolOk = result?.ok === true
        } catch (error) {
          toolContent = JSON.stringify({ ok: false, error: errorMessage(error) })
        }
        toolContent = reserializeToolContent(toolContent, Math.max(128, toolBudget.remainingTokens * 3))
        toolOk = toolOk && jsonResultOk(toolContent)
        toolBudget.remainingTokens = Math.max(0, toolBudget.remainingTokens - estimateProtocolTokens(toolContent))
        toolOutcomes.push({ type: 'result', content: toolContent, ok: toolOk })
        protocolMessages.push({ role: 'tool', tool_call_id: call.id, content: toolContent })
      }
      if (sources.length > 0) {
        this.ctx.chatStorage.updateMessage(assistantMessage.id, { sources })
        yield { type: 'sources', messageId: assistantMessage.id, sources: [...sources] }
      }

      if (!toolOutcomes.some(outcome => outcome.ok)) {
        throwIfAborted(controller.signal)
        content = explainFailedTools(toolOutcomes)
        this.ctx.chatStorage.updateMessage(assistantMessage.id, { content })
        yield { type: 'delta', messageId: assistantMessage.id, delta: content }
        const message = this.ctx.chatStorage.updateMessage(assistantMessage.id, {
          content,
          state: 'completed',
          sources: [],
          tokenUsage: usage,
        })
        terminal = true
        yield { type: 'completed', message }
        return
      }

      const finalMessages = protocolMessages
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let finishReason: string | undefined
        try {
          for await (const event of this.ctx.llmClient.stream({
            settings: endpoint,
            messages: attempt === 0 ? finalMessages : reserializeToolResults(finalMessages),
            signal: controller.signal,
            temperature: 0.2,
          })) {
            throwIfAborted(controller.signal)
            if (event.type === 'delta') {
              content += event.content
              this.ctx.chatStorage.updateMessage(assistantMessage.id, { content })
              yield { type: 'delta', messageId: assistantMessage.id, delta: event.content }
            } else if (event.type === 'usage') {
              usage = addUsage(usage, streamUsage(event))
              yield { type: 'usage', messageId: assistantMessage.id, usage }
            } else if (event.type === 'tool-calls') {
              throw new Error('模型在最终回答阶段意外调用了工具')
            } else if (event.type === 'finish') {
              finishReason = event.reason
            }
          }
          validateStreamFinish(finishReason, '最终回答')
          break
        } catch (error) {
          if (attempt === 0 && content.length === 0 && isContextOverflow(error)) continue
          throw error
        }
      }

      throwIfAborted(controller.signal)
      if (content.trim().length === 0) throw new Error('LLM 最终响应缺少文本内容')
      content = sanitizeUnavailableCitations(content, sources)
      const current = this.ctx.chatStorage.getMessage(assistantMessage.id)
      if (current === undefined || current.state !== 'generating') throwIfAborted(controller.signal)
      const message = this.ctx.chatStorage.updateMessage(assistantMessage.id, {
        content,
        state: 'completed',
        sources: citedSources(content, sources),
        tokenUsage: usage,
      })
      terminal = true
      yield { type: 'completed', message }
    } catch (error) {
      if (controller.signal.aborted) {
        const message = this.finishCancelled(assistantMessage.id, assistantMessage)
        terminal = true
        yield { type: 'cancelled', message }
      } else {
        const messageText = errorMessage(error)
        this.ctx.chatStorage.updateMessage(assistantMessage.id, {
          content,
          state: 'failed',
          error: messageText,
          tokenUsage: usage,
        })
        terminal = true
        yield { type: 'error', messageId: assistantMessage.id, error: messageText }
      }
    } finally {
      if (!terminal) {
        controller.abort()
        this.finishCancelled(assistantMessage.id, assistantMessage)
      }
      if (this.active.get(libraryId)?.controller === controller) this.active.delete(libraryId)
    }
  }

  private async *executeTool(
    libraryId: string,
    input: SendLibraryChatMessageInput,
    endpoint: LlmResolvedEndpoint,
    tool: LibraryToolArguments,
    sources: LibraryChatSource[],
    sourceNumbers: Map<string, number>,
    signal: AbortSignal,
    maximumResultCharacters: number,
  ): AsyncGenerator<ToolExecutionEvent> {
    if (tool.name === 'search_knowledge') {
      yield { type: 'progress', completed: 0, total: 1, phase: 'searching', message: '正在检索当前知识库' }
      const result = this.searchKnowledge(libraryId, tool.query, sources, sourceNumbers, maximumResultCharacters)
      yield { type: 'progress', completed: 1, total: 1, phase: 'searching', message: '检索完成' }
      yield result
      return
    }

    const ready = this.ctx.knowledgeCatalog.listDocuments(libraryId)
      .filter(document => document.indexStatus === 'ready')
    if (tool.name === 'summarize_current_document') {
      const document = input.contextDocumentId === undefined
        ? undefined
        : this.ctx.knowledgeCatalog.getDocuments([input.contextDocumentId])[0]
      if (document === undefined) throw new Error('当前没有可总结的上下文文档')
      if (document.libraryId !== libraryId) throw new Error('当前文档不属于正在聊天的知识库')
      if (document.indexStatus !== 'ready') throw new Error('当前文档尚未完成索引')
      yield* this.summarizeDocuments(
        [document],
        tool.focus,
        endpoint,
        sources,
        sourceNumbers,
        signal,
        false,
        maximumResultCharacters,
      )
      return
    }
    if (tool.name === 'summarize_named_document') {
      const matches = matchDocuments(ready, tool.title)
      if (matches.length !== 1) {
        yield {
          type: 'result',
          content: JSON.stringify({
            ok: false,
            clarificationRequired: true,
            error: matches.length === 0 ? '未找到匹配文档，请用户确认标题' : '匹配到多个文档，请用户明确选择',
            candidates: matches.map(document => ({
              documentId: document.id,
              title: document.title,
              originalName: document.originalName,
            })),
          }),
          ok: false,
        }
        return
      }
      yield* this.summarizeDocuments(matches, tool.focus, endpoint, sources, sourceNumbers, signal, false, maximumResultCharacters)
      return
    }
    if (ready.length === 0) throw new Error('当前知识库没有已就绪文档')
    yield* this.summarizeDocuments(ready, tool.focus, endpoint, sources, sourceNumbers, signal, true, maximumResultCharacters)
  }

  private async *summarizeDocuments(
    documents: KnowledgeDocument[],
    focus: string | undefined,
    endpoint: LlmResolvedEndpoint,
    sources: LibraryChatSource[],
    sourceNumbers: Map<string, number>,
    signal: AbortSignal,
    combine = false,
    maximumResultCharacters = 12_000,
  ): AsyncGenerator<ToolExecutionEvent> {
    const summaries: string[] = []
    const references: Array<{ citation: string, documentId: string, title: string, summary?: string }> = []
    const hasLibraryReduce = combine && documents.length > 1
    const total = documents.length + (hasLibraryReduce ? 1 : 0)
    yield { type: 'progress', completed: 0, total, phase: 'map', message: '开始读取索引分块' }
    for (let index = 0; index < documents.length; index += 1) {
      throwIfAborted(signal)
      const document = documents[index]
      if (document === undefined) continue
      const result = await summarizeDocument({
        llmClient: this.ctx.llmClient,
        cache: this.ctx.chatStorage,
        listDocumentChunks: id => this.ctx.knowledgeIndex.listDocumentChunks(id),
      }, document, endpoint, focus, signal)
      const citationNumber = registerSource(sources, sourceNumbers, `document:${document.id}`, {
        documentId: document.id,
        libraryId: document.libraryId,
        title: document.title,
        referenceUri: referenceUri(document.libraryId, document.id),
        location: '索引全文摘要',
        snippet: result.summary.slice(0, 240),
        score: 0,
      })
      const citedSummary = `[${citationNumber}] ${document.title}\n${result.summary}`
      summaries.push(citedSummary)
      references.push({
        citation: `[${citationNumber}]`,
        documentId: document.id,
        title: document.title,
        ...(combine ? {} : { summary: result.summary }),
      })
      yield {
        type: 'progress',
        completed: index + 1,
        total,
        phase: result.cached ? 'cache-hit' : focus === undefined ? 'map' : 'focus',
        message: `${document.title}：${result.cached ? '使用缓存' : '摘要完成'}`,
      }
    }
    let combinedSummary: string | undefined
    if (combine && summaries.length === 1) {
      combinedSummary = summaries[0]
    } else if (hasLibraryReduce) {
      yield {
        type: 'progress',
        completed: documents.length,
        total,
        phase: 'reduce',
        message: '正在归并整库摘要',
      }
      combinedSummary = await reduceSummaries(
        this.ctx.llmClient,
        summaries,
        '当前知识库全部文档',
        focus,
        endpoint,
        signal,
      )
      yield {
        type: 'progress',
        completed: total,
        total,
        phase: 'reduce',
        message: '整库摘要归并完成',
      }
    }
    const payload = {
      ok: true,
      evidence: true,
      focus: focus ?? null,
      coverage: '基于所有已就绪文档的全部可用索引分块；索引是否覆盖原始文件全文无法由本工具独立保证',
      ...(combinedSummary === undefined ? {} : { combinedSummary }),
      sources: references,
    }
    yield {
      type: 'result',
      content: boundedSummaryJson(payload, maximumResultCharacters),
      ok: true,
    }
  }

  private searchKnowledge(
    libraryId: string,
    query: string,
    sources: LibraryChatSource[],
    sourceNumbers: Map<string, number>,
    maximumResultCharacters: number,
  ): ToolExecutionResult {
    const search = (text: string, topK: number): KnowledgeSearchResult[] => this.ctx.knowledgeQuery.search({
      text,
      knowledgeBaseIds: [libraryId],
      mode: 'keyword',
      topK,
    }).results.filter(result => result.knowledgeBaseId === libraryId)
    const exact = search(query, SEARCH_TOP_K)
    const aggregated = new Map<string, {
      result: KnowledgeSearchResult
      matchedQueries: Set<string>
      bestRank: number
      bestScore: number
    }>()
    const merge = (results: KnowledgeSearchResult[], matchedQuery: string): void => {
      results.forEach((result, rank) => {
        const existing = aggregated.get(result.chunkId)
        if (existing === undefined) {
          aggregated.set(result.chunkId, {
            result,
            matchedQueries: new Set([matchedQuery]),
            bestRank: rank,
            bestScore: result.score,
          })
          return
        }
        existing.matchedQueries.add(matchedQuery)
        if (result.score > existing.bestScore || (result.score === existing.bestScore && rank < existing.bestRank)) {
          existing.result = result
        }
        existing.bestRank = Math.min(existing.bestRank, rank)
        existing.bestScore = Math.max(existing.bestScore, result.score)
      })
    }
    merge(exact, query)
    const fallbackQueries = exact.length < SEARCH_TOP_K ? searchQueryCandidates(query) : []
    for (const candidate of fallbackQueries) merge(search(candidate, SEARCH_FALLBACK_TOP_K), candidate)
    const ranked = [...aggregated.values()]
      .sort((left, right) => (
        right.matchedQueries.size - left.matchedQueries.size
        || right.bestScore - left.bestScore
        || left.bestRank - right.bestRank
        || left.result.chunkId.localeCompare(right.result.chunkId)
      ))
      .slice(0, SEARCH_TOP_K)
    const evidence = ranked
      .map(({ result, matchedQueries }) => {
        const matchedBy = [...matchedQueries]
        const chunks = this.ctx.knowledgeIndex.listDocumentChunks(result.documentId)
        const at = chunks.findIndex(chunk => chunk.chunkId === result.chunkId)
        const nearby = (at < 0 ? [] : chunks.slice(Math.max(0, at - 1), at + 2))
          .map(chunk => `${chunk.location}：${chunk.body}`)
          .join('\n')
          .slice(0, 6_000)
        const citationNumber = registerSource(sources, sourceNumbers, `chunk:${result.chunkId}`, {
          documentId: result.documentId,
          libraryId,
          title: result.title,
          referenceUri: referenceUri(libraryId, result.documentId),
          location: result.location,
          snippet: stripSnippetMarkup(result.snippet),
          score: result.score,
        })
        return {
          citation: `[${citationNumber}]`,
          documentId: result.documentId,
          title: result.title,
          location: result.location,
          snippet: stripSnippetMarkup(result.snippet),
          nearbyText: nearby,
          matchedQueries: matchedBy,
        }
      })
    const payload = {
      ok: evidence.length > 0,
      evidenceFound: evidence.length > 0,
      ...(evidence.length === 0 ? { error: '未在当前知识库中检索到匹配证据' } : {}),
      query,
      fallbackQueries,
      evidence,
      sources: evidence.map(item => ({
      citation: item.citation,
      documentId: item.documentId,
      title: item.title,
      location: item.location,
      })),
    }
    return {
      type: 'result',
      ok: evidence.length > 0,
      content: boundedSearchJson(payload, maximumResultCharacters),
    }
  }

  private async buildBaseMessages(
    libraryId: string,
    input: SendLibraryChatMessageInput,
    endpoint: LlmResolvedEndpoint,
    aggressive: boolean,
    phase: 'planner' | 'final',
  ): Promise<ChatMessage[]> {
    const snapshot = this.ctx.chatStorage.snapshot(libraryId)
    const usable = completedTurnMessages(snapshot.messages)
    const recentCount = aggressive ? 2 : RECENT_MESSAGE_COUNT
    const rawRecentStart = Math.max(0, usable.length - recentCount)
    const desiredRecentStart = usable[rawRecentStart]?.role === 'assistant'
      ? Math.min(usable.length, rawRecentStart + 1)
      : rawRecentStart
    const inputBudget = Math.max(1_000, endpoint.maxInputTokens - endpoint.maxOutputTokens)
    const pressureTokens = usable.reduce((total, message) => total + estimateTokens(message.content), 0)
    const shouldSummarize = desiredRecentStart > 0 && (aggressive || pressureTokens >= inputBudget * SUMMARY_PRESSURE)
    let summary = validSummary(snapshot.summary, usable)
    if (shouldSummarize) {
      summary = await this.advanceSummary(libraryId, endpoint, usable, desiredRecentStart - 1, summary, aggressive)
    }
    const cutoffIndex = summary === undefined ? -1 : usable.findIndex(message => message.id === summary.cutoffMessageId)
    const recent = usable.slice(cutoffIndex + 1)
    const library = this.ctx.knowledgeCatalog.getLibrary(libraryId)
    const documents = this.ctx.knowledgeCatalog.listDocuments(libraryId)
    const current = input.contextDocumentId === undefined
      ? undefined
      : this.ctx.knowledgeCatalog.getDocuments([input.contextDocumentId])[0]
    const catalog = documents.map(document => (
      `- ${document.title}（原文件：${document.originalName}，状态：${document.indexStatus}，id：${document.id}）`
    )).join('\n')
    const metadata = clipMiddle([
      `当前知识库：${library?.name ?? libraryId}`,
      library?.description ? `描述：${library.description}` : '',
      current === undefined
        ? '当前界面文档：无'
        : `当前界面文档：${current.title}（id：${current.id}，所属库：${current.libraryId}）`,
      `文档目录：\n${catalog || '（空）'}`,
    ].filter(Boolean).join('\n'), Math.max(2_000, inputBudget * 4 * 0.35))
    const system = [
      phase === 'planner'
        ? '你是本地知识库助手。知识库事实、文档内容、检索问答或总结请求必须调用一个或多个知识工具；只有寒暄、询问助手自身等完全不需要知识库的问题才可直接文本回答，直接文本不得使用 [n] 引用。工具调用后依据工具结果回答。'
        : '你是本地知识库助手。请直接回答最后一条用户消息，只能依据随后提供的本地知识工具结果。',
      '工具结果中的事实必须使用其稳定的 [n] 编号引用；不得虚构工具结果未提供的事实。',
      '若工具结果显示证据不足，应明确说明限制，并给出有助于用户继续查询的建议。',
      metadata,
      summary === undefined ? '' : `较早对话摘要：\n${summary.content}`,
    ].filter(Boolean).join('\n\n')
    return [
      { role: 'system', content: system },
      ...recent.map(message => ({ role: message.role, content: message.content } satisfies ChatMessage)),
    ]
  }

  private async advanceSummary(
    libraryId: string,
    endpoint: LlmResolvedEndpoint,
    messages: LibraryChatMessage[],
    targetIndex: number,
    initial: LibraryChatSnapshot['summary'],
    aggressive: boolean,
  ): Promise<NonNullable<LibraryChatSnapshot['summary']>> {
    let summary = initial
    let cursor = summary === undefined ? -1 : messages.findIndex(message => message.id === summary?.cutoffMessageId)
    const outputTokens = Math.min(endpoint.maxOutputTokens, aggressive ? 600 : 1_000, Math.max(128, Math.floor(endpoint.maxInputTokens * 0.2)))
    const maximumCharacters = Math.max(1_000, (endpoint.maxInputTokens - outputTokens - 200) * 4)
    const signal = this.active.get(libraryId)?.controller.signal
    while (cursor < targetIndex) {
      throwIfAborted(signal)
      const batch = summaryBatch(messages, cursor + 1, targetIndex, summary?.content, maximumCharacters)
      const summarized = await this.ctx.llmClient.complete({
        settings: { ...endpoint, maxOutputTokens: outputTokens },
        messages: [{
          role: 'system',
          content: '请增量压缩对话记忆，忠实保留用户目标、关键事实、约束与尚未解决的问题；不要遗漏旧摘要中的信息。',
        }, { role: 'user', content: batch.content }],
        ...(signal === undefined ? {} : { signal }),
        temperature: 0,
      })
      throwIfAborted(signal)
      cursor = batch.endIndex
      summary = {
        content: summarized.content,
        cutoffMessageId: messages[cursor]?.id ?? '',
        updatedAt: new Date().toISOString(),
      }
      this.ctx.chatStorage.saveSummary(libraryId, summary)
    }
    if (summary === undefined) throw new Error('聊天摘要未生成')
    return summary
  }

  private resolveEndpoint(modelId: string | undefined): LlmResolvedEndpoint {
    const settings = this.ctx.settings.llmIntegration(
      (providerId: string) => this.ctx.llmCredentials.status(providerId),
    )
    const endpoint = modelId === undefined
      ? resolvePreferredLlmModel(settings)
      : resolveLlmModel(settings, modelId)
    if (endpoint === undefined) throw new RangeError('请求的聊天模型不存在')
    if (!endpoint.apiKeyConfigured) throw new RangeError('聊天模型尚未配置 API Key')
    return endpoint
  }

  private validateLibrary(libraryId: string): void {
    validateLibraryId(libraryId)
    if (this.ctx.knowledgeCatalog.getLibrary(libraryId) === undefined) throw new RangeError('知识库不存在')
  }

  private finishCancelled(messageId: string, fallback: LibraryChatMessage): LibraryChatMessage {
    const current = this.ctx.chatStorage.getMessage(messageId)
    if (current === undefined) return { ...fallback, state: 'cancelled', updatedAt: new Date().toISOString() }
    return current.state === 'generating'
      ? this.ctx.chatStorage.updateMessage(messageId, { state: 'cancelled' })
      : current
  }
}

function createMessage(
  libraryId: string,
  role: 'user' | 'assistant',
  state: 'generating' | 'completed',
  content: string,
  now: string,
  modelId?: string,
): LibraryChatMessage {
  return {
    id: randomUUID(),
    libraryId,
    role,
    state,
    content,
    ...(modelId === undefined ? {} : { modelId }),
    sources: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    createdAt: now,
    updatedAt: now,
  }
}

function registerSource(
  sources: LibraryChatSource[],
  numbers: Map<string, number>,
  key: string,
  source: LibraryChatSource,
): number {
  const existing = numbers.get(key)
  if (existing !== undefined) return existing
  const citationNumber = sources.length + 1
  numbers.set(key, citationNumber)
  sources.push({ ...source, citationNumber })
  return citationNumber
}

function matchDocuments(documents: KnowledgeDocument[], title: string): KnowledgeDocument[] {
  const needle = title.trim().toLocaleLowerCase()
  const exact = documents.filter(document => (
    document.title.toLocaleLowerCase() === needle || document.originalName.toLocaleLowerCase() === needle
  ))
  if (exact.length > 0) return exact
  return documents.filter(document => (
    document.title.toLocaleLowerCase().includes(needle) || document.originalName.toLocaleLowerCase().includes(needle)
  ))
}

function referenceUri(libraryId: string, documentId: string): `tk://local/${string}` {
  return `tk://local/${encodeURIComponent(libraryId)}/${encodeURIComponent(documentId)}`
}

function citedSources(content: string, sources: LibraryChatSource[]): LibraryChatSource[] {
  const cited = new Set<number>()
  for (const match of content.matchAll(/\[(\d{1,3})\]/g)) {
    const number = Number(match[1])
    if (Number.isInteger(number) && number > 0) cited.add(number)
  }
  return sources.filter(source => source.citationNumber !== undefined && cited.has(source.citationNumber))
}

function sanitizeUnavailableCitations(content: string, sources: LibraryChatSource[]): string {
  const available = new Set(sources.flatMap(source => (
    source.citationNumber === undefined ? [] : [source.citationNumber]
  )))
  return content.replace(/\[(\d{1,6})\]/g, (citation, rawNumber: string) => (
    available.has(Number(rawNumber)) ? citation : ''
  )).replace(/[ \t]{2,}/g, ' ').trim()
}

function reserializeToolResults(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(message => message.role === 'tool'
    ? { ...message, content: reserializeToolContent(message.content, Math.max(128, Math.floor(message.content.length / 2))) }
    : message)
}

function reserializeToolContent(content: string, maximumCharacters: number): string {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    value = { ok: false, error: '工具结果不是有效 JSON' }
  }
  return boundedGenericJson(value, maximumCharacters)
}

function boundedSearchJson(
  input: {
    ok: boolean
    evidenceFound: boolean
    query: string
    evidence: Array<Record<string, unknown>>
    sources: Array<Record<string, unknown>>
  },
  maximumCharacters: number,
): string {
  const value = structuredClone(input)
  while (JSON.stringify(value).length > maximumCharacters) {
    const longNearby = value.evidence.find(item => typeof item.nearbyText === 'string' && item.nearbyText.length > 240)
    if (longNearby !== undefined) {
      longNearby.nearbyText = clipMiddle(String(longNearby.nearbyText), Math.max(240, Math.floor(String(longNearby.nearbyText).length / 2)))
      continue
    }
    if (value.evidence.length > 1) {
      value.evidence.pop()
      value.sources = value.sources.slice(0, value.evidence.length)
      continue
    }
    break
  }
  return boundedGenericJson(value, maximumCharacters)
}

function boundedSummaryJson(
  input: {
    ok: boolean
    evidence: boolean
    focus: string | null
    coverage: string
    combinedSummary?: string
    sources: Array<{ citation: string, documentId: string, title: string, summary?: string }>
  },
  maximumCharacters: number,
): string {
  const value = {
    ...structuredClone(input),
    omittedSourceMetadata: 0,
  }
  const originalSourceCount = value.sources.length
  while (JSON.stringify(value).length > maximumCharacters) {
    const sourceWithSummary = value.sources.find(source => typeof source.summary === 'string' && source.summary.length > 240)
    if (sourceWithSummary?.summary !== undefined) {
      sourceWithSummary.summary = clipMiddle(sourceWithSummary.summary, Math.max(240, Math.floor(sourceWithSummary.summary.length / 2)))
      continue
    }
    if (typeof value.combinedSummary === 'string' && value.combinedSummary.length > 500) {
      value.combinedSummary = clipWithCitationSet(value.combinedSummary, Math.max(500, Math.floor(value.combinedSummary.length / 2)))
      continue
    }
    if (value.sources.length > 1) {
      value.sources.pop()
      value.omittedSourceMetadata = originalSourceCount - value.sources.length
      continue
    }
    break
  }
  return boundedGenericJson(value, maximumCharacters)
}

function boundedGenericJson(input: unknown, maximumCharacters: number): string {
  const minimum = JSON.stringify({ ok: false, error: '工具结果超过当前模型的上下文预算' })
  if (maximumCharacters < minimum.length) return minimum
  let value = structuredClone(input) as Record<string, unknown>
  let serialized = JSON.stringify(value)
  for (let attempt = 0; serialized.length > maximumCharacters && attempt < 32; attempt += 1) {
    const target = longestString(value)
    if (target === undefined || target.value.length <= 32) break
    target.parent[target.key] = clipMiddle(target.value, Math.max(16, Math.floor(target.value.length / 2)))
    serialized = JSON.stringify(value)
  }
  if (serialized.length <= maximumCharacters) return serialized
  return minimum
}

function longestString(value: unknown): { parent: Record<string, unknown>, key: string, value: string } | undefined {
  let longest: { parent: Record<string, unknown>, key: string, value: string } | undefined
  const visit = (current: unknown): void => {
    if (current === null || typeof current !== 'object') return
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    const object = current as Record<string, unknown>
    for (const [key, child] of Object.entries(object)) {
      if (typeof child === 'string' && (longest === undefined || child.length > longest.value.length)) {
        longest = { parent: object, key, value: child }
      } else {
        visit(child)
      }
    }
  }
  visit(value)
  return longest
}

function createToolResultBudget(endpoint: LlmResolvedEndpoint, messages: ChatMessage[]): { remainingTokens: number } {
  const used = estimateProtocolTokens(JSON.stringify(messages))
    + endpoint.maxOutputTokens
    + TOOL_RESULT_TOKEN_RESERVE
  const remainingTokens = endpoint.maxInputTokens - used
  if (remainingTokens < 64) throw new Error('当前模型输入上下文不足以容纳工具结果')
  return { remainingTokens }
}

function estimateProtocolTokens(value: string): number {
  return Math.ceil(value.length / 3)
}

function jsonResultOk(content: string): boolean {
  try {
    return (JSON.parse(content) as { ok?: unknown }).ok === true
  } catch {
    return false
  }
}

function clipWithCitationSet(value: string, maximumCharacters: number): string {
  if (value.length <= maximumCharacters) return value
  const citations = [...new Set([...value.matchAll(/\[(\d{1,6})\]/g)].map(match => `[${match[1]}]`))].join(' ')
  const citationPrefix = citations.length === 0 ? '' : `${citations}\n`
  const bodyMaximum = Math.max(1, maximumCharacters - citationPrefix.length)
  return `${citationPrefix}${clipMiddle(value, bodyMaximum)}`.slice(0, maximumCharacters)
}

function explainFailedTools(outcomes: ToolExecutionResult[]): string {
  const errors: string[] = []
  const candidates: string[] = []
  for (const outcome of outcomes) {
    try {
      const payload = JSON.parse(outcome.content) as {
        error?: unknown
        candidates?: Array<{ title?: unknown, originalName?: unknown }>
      }
      if (typeof payload.error === 'string') errors.push(payload.error)
      for (const candidate of payload.candidates ?? []) {
        const title = typeof candidate.title === 'string' ? candidate.title : '未命名文档'
        const originalName = typeof candidate.originalName === 'string' ? `（${candidate.originalName}）` : ''
        candidates.push(`${title}${originalName}`)
      }
    } catch {
      errors.push('工具返回了无法解释的结果')
    }
  }
  const uniqueErrors = [...new Set(errors)]
  const uniqueCandidates = [...new Set(candidates)]
  return [
    '无法基于当前知识库生成可靠回答。',
    ...uniqueErrors.map(error => `- ${error}`),
    ...(uniqueCandidates.length === 0 ? [] : [
      '请明确选择以下文档之一：',
      ...uniqueCandidates.map(candidate => `- ${candidate}`),
    ]),
  ].join('\n')
}

export function searchQueryCandidates(query: string): string[] {
  const candidates: Array<{ value: string, priority: number, position: number }> = []
  const add = (value: string, priority: number, position: number): void => {
    const normalized = value.trim().replace(/\s+/g, ' ')
    if (normalized.length < 2 || normalized.length > 40 || normalized === query.trim()) return
    if (/^(请问|多少|什么|哪些|怎么|如何|是否|可以|一个|这个|那个)$/.test(normalized)) return
    candidates.push({ value: normalized, priority, position })
  }

  for (const match of query.matchAll(/["“”'‘’]([^"“”'‘’]{2,40})["“”'‘’]/g)) {
    add(match[1] ?? '', 120, match.index ?? 0)
  }
  for (const match of query.matchAll(/[A-Za-z][A-Za-z0-9_+.-]{1,31}|\d+(?:\.\d+)?/g)) {
    add(match[0], /[A-Za-z]/.test(match[0]) ? 110 : 100, match.index ?? 0)
  }

  const stopExpression = /(?:请问|麻烦|帮我|告诉我|是多少|有多少|多少个?|什么|哪些|怎么|如何|为什么|是否|了吗|了|呢|吗|呀|啊)/g
  for (const run of query.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const basePosition = run.index ?? 0
    const segments = run[0].split(stopExpression).filter(segment => segment.length >= 2)
    for (const segment of segments) {
      if (segment.length <= 4) {
        add(segment, 80 + segment.length, basePosition)
        continue
      }
      for (let offset = 0; offset <= segment.length - 4; offset += 1) {
        add(segment.slice(offset, offset + 4), 90, basePosition + offset)
      }
      if (segment.length <= 7) add(segment, 95, basePosition)
    }
  }

  const seen = new Set<string>()
  const unique = candidates
    .sort((left, right) => right.priority - left.priority || right.value.length - left.value.length || left.position - right.position)
    .flatMap(candidate => {
      const key = candidate.value.toLocaleLowerCase()
      if (seen.has(key)) return []
      seen.add(key)
      return [candidate]
    })
  const discriminating = unique.filter(candidate => candidate.priority >= 90)
  return (discriminating.length > 0 ? discriminating : unique)
    .map(candidate => candidate.value)
    .slice(0, MAX_SEARCH_CANDIDATES)
}

export function completedTurnMessages(messages: LibraryChatMessage[]): LibraryChatMessage[] {
  const usable: LibraryChatMessage[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const user = messages[index]
    if (user?.role !== 'user' || user.state !== 'completed') continue
    const assistant = messages[index + 1]
    if (assistant?.role !== 'assistant') continue
    if (assistant.state === 'completed') {
      usable.push(user, assistant)
    } else if (assistant.state === 'generating' && index + 1 === messages.length - 1) {
      usable.push(user)
    }
    index += 1
  }
  return usable
}

function stripSnippetMarkup(value: string): string {
  return value.replace(/<\/?mark>/gi, '')
}

function validSummary(
  summary: LibraryChatSnapshot['summary'],
  messages: LibraryChatMessage[],
): LibraryChatSnapshot['summary'] {
  return summary !== undefined && messages.some(message => message.id === summary.cutoffMessageId) ? summary : undefined
}

interface SummaryBatch {
  content: string
  endIndex: number
}

function summaryBatch(
  messages: LibraryChatMessage[],
  startIndex: number,
  targetIndex: number,
  previousSummary: string | undefined,
  maximumCharacters: number,
): SummaryBatch {
  const old = previousSummary === undefined
    ? ''
    : `已有摘要：\n${clipMiddle(previousSummary, Math.floor(maximumCharacters * 0.4))}\n\n新增对话：\n`
  let content = old
  let endIndex = startIndex - 1
  for (let index = startIndex; index <= targetIndex; index += 1) {
    const message = messages[index]
    if (message === undefined) break
    const prefix = `${message.role}: `
    const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n'
    const available = maximumCharacters - content.length - separator.length - prefix.length
    if (available <= 0 && endIndex >= startIndex) break
    content += `${separator}${prefix}${clipMiddle(message.content, Math.max(1, available))}`
    endIndex = index
    if (content.length >= maximumCharacters) break
  }
  if (endIndex < startIndex) throw new Error('聊天摘要输入预算不足')
  return { content, endIndex }
}

function clipMiddle(value: string, maximumCharacters: number): string {
  if (value.length <= maximumCharacters) return value
  if (maximumCharacters < 20) return value.slice(0, maximumCharacters)
  const half = Math.floor((maximumCharacters - 5) / 2)
  return `${value.slice(0, half)}\n…\n${value.slice(-half)}`
}

function validateLibraryId(libraryId: string): void {
  if (libraryId.trim().length === 0 || libraryId.length > 200) throw new RangeError('知识库 ID 无效')
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new Error('聊天生成已取消')
}

function streamUsage(event: Extract<ChatCompletionStreamEvent, { type: 'usage' }>): LibraryChatTokenUsage {
  return { inputTokens: event.inputTokens, outputTokens: event.outputTokens }
}

function addUsage(left: LibraryChatTokenUsage, right: LibraryChatTokenUsage): LibraryChatTokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  }
}

function isContextOverflow(error: unknown): boolean {
  return /(context|token|length|上下文|长度).*(exceed|maximum|limit|超|限制)/i.test(errorMessage(error))
}

function syntheticToolCall(route: RoutedLibraryChatMessage): ToolCall {
  return {
    id: randomUUID(),
    type: 'function',
    function: {
      name: route.toolName,
      arguments: JSON.stringify(route.args),
    },
  }
}

function validateStreamFinish(reason: string | undefined, phase: '工具决策' | '最终回答'): void {
  if (reason === 'length') throw new Error(`LLM ${phase}因长度限制被截断`)
  if (reason === 'content_filter') throw new Error(`LLM ${phase}被内容过滤器终止`)
  if (reason !== undefined && reason !== 'stop' && reason !== 'tool_calls') {
    throw new Error(`LLM ${phase}以非预期原因终止：${reason}`)
  }
  if (phase === '最终回答' && reason === 'tool_calls') throw new Error('模型在最终回答阶段意外调用了工具')
}

function isUnsupportedNativeTools(error: unknown): boolean {
  const message = errorMessage(error)
  const mentionsTools = /\btools?\b|tool_choice|function[ -]?calling|函数调用/i.test(message)
  const explicitlyUnsupported = /not supported|unsupported|unknown (?:field|parameter)|unrecognized|unexpected field|extra inputs|不支持|未知字段|无法识别|非法字段/i.test(message)
  return mentionsTools && explicitlyUnsupported
}

function isInvalidToolCall(error: unknown): boolean {
  return /未知工具|工具 .*arguments|工具参数|tool call|工具调用|tool_calls 结束/i.test(errorMessage(error))
}

function routedToolArguments(route: RoutedLibraryChatMessage): LibraryToolArguments {
  if (route.toolName === 'search_knowledge') return { name: route.toolName, ...route.args }
  if (route.toolName === 'summarize_named_document') return { name: route.toolName, ...route.args }
  return { name: route.toolName, ...route.args }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default LibraryChat
