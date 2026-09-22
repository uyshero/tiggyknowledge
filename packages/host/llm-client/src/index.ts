import { Context, Service } from '@deepseek-ai/cordis'
import type { LlmResolvedEndpoint, TestLlmConnectionResult } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/llm-credentials'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmClient: OpenAiCompatibleClient
  }
}

export interface TextChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface AssistantToolCallMessage {
  role: 'assistant'
  content?: string | null
  tool_calls: ToolCall[]
}

export interface ToolResultChatMessage {
  role: 'tool'
  content: string
  tool_call_id: string
}

export type ChatMessage = TextChatMessage | AssistantToolCallMessage | ToolResultChatMessage

export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } }

export interface ChatCompletionInput {
  settings: LlmResolvedEndpoint
  messages: ChatMessage[]
  signal?: AbortSignal
  temperature?: number
  json?: boolean
  maxAttempts?: number
}

export interface ChatCompletionResult {
  content: string
  inputTokens: number
  outputTokens: number
}

export interface TranscriptionInput {
  settings: LlmResolvedEndpoint
  bytes: Uint8Array
  filename: string
  mimeType: string
  signal?: AbortSignal
}

export interface TranscriptionResult {
  text: string
}

export interface ChatCompletionStreamInput extends Omit<ChatCompletionInput, 'json' | 'maxAttempts'> {
  tools?: ToolSchema[]
  toolChoice?: ToolChoice
}

export type ChatCompletionFinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter'

export type ChatCompletionStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool-call-delta'; index: number; id: string; name: string; argumentsDelta: string }
  | { type: 'tool-calls'; toolCalls: ToolCall[] }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'finish'; reason: ChatCompletionFinishReason }

interface CompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
  }
  error?: {
    message?: unknown
  }
}

interface TranscriptionResponse {
  text?: unknown
  error?: {
    message?: unknown
  }
}

export class OpenAiCompatibleClient extends Service {
  static inject = ['llmCredentials']

  constructor(ctx: Context) {
    super(ctx, 'llmClient')
  }

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    validateSettings(input.settings)
    if (input.messages.length === 0) throw new RangeError('LLM 消息不能为空')
    const maxAttempts = input.maxAttempts ?? 1
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
      throw new RangeError('LLM 最大尝试次数必须为 1 到 3')
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.completeOnce(input)
      } catch (error) {
        if (input.signal?.aborted === true || attempt === maxAttempts || !isRetryable(error)) throw error
        await wait(1_000 * 2 ** (attempt - 1), input.signal)
      }
    }
    throw new Error('LLM 请求未执行')
  }

  async *stream(input: ChatCompletionStreamInput): AsyncGenerator<ChatCompletionStreamEvent> {
    validateSettings(input.settings)
    if (input.messages.length === 0) throw new RangeError('LLM 消息不能为空')
    const timeoutSignal = AbortSignal.timeout(input.settings.requestTimeoutMs)
    const signal = input.signal === undefined ? timeoutSignal : AbortSignal.any([input.signal, timeoutSignal])
    let response: Response
    try {
      response = await fetch(completionUrl(input.settings.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.ctx.llmCredentials.getApiKey(input.settings.providerId)}`,
          accept: 'text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.settings.model,
          messages: input.messages,
          max_tokens: input.settings.maxOutputTokens,
          stream: true,
          stream_options: { include_usage: true },
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...(input.tools === undefined ? {} : { tools: input.tools }),
          ...(input.toolChoice === undefined ? {} : { tool_choice: input.toolChoice }),
          ...providerRequestOptions(input.settings),
        }),
        signal,
      })
    } catch (error) {
      throw requestFailure(error, signal, input.signal, input.settings.requestTimeoutMs)
    }
    if (!response.ok) {
      const raw = await response.text()
      let message = raw.slice(0, 500)
      try {
        const payload = JSON.parse(raw) as CompletionResponse
        if (typeof payload.error?.message === 'string') message = payload.error.message
      } catch {
        // Preserve the provider's raw error body.
      }
      throw new Error(`LLM 请求失败（HTTP ${response.status}）：${message}`)
    }
    if (response.body === null) throw new Error('LLM 流式响应缺少响应体')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let dataLines: string[] = []
    const toolCalls = new Map<number, PartialToolCall>()
    let finishReason: ChatCompletionFinishReason | undefined
    let receivedDone = false
    const emitFrame = function* (): Generator<ChatCompletionStreamEvent | 'done'> {
      if (dataLines.length === 0) return
      const data = dataLines.join('\n').trim()
      dataLines = []
      if (data === '[DONE]') {
        receivedDone = true
        const reason = finishReason ?? 'stop'
        if (reason === 'tool_calls') {
          const completedCalls = [...toolCalls.values()]
            .sort((left, right) => left.index - right.index)
            .map(call => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: call.arguments },
            }))
          validateCompletedToolCalls(completedCalls)
          yield {
            type: 'tool-calls',
            toolCalls: completedCalls,
          }
        } else if (toolCalls.size > 0 && reason === 'stop') {
          throw new Error(`LLM 服务在 finish_reason=${reason} 时返回了未完成的工具调用`)
        }
        yield { type: 'finish', reason }
        yield 'done'
        return
      }
      let payload: StreamResponse
      try {
        payload = JSON.parse(data) as StreamResponse
      } catch {
        throw new Error('LLM 服务返回了无效 SSE JSON')
      }
      if (typeof payload.error?.message === 'string') throw new Error(`LLM 流式请求失败：${payload.error.message}`)
      for (const choice of payload.choices ?? []) {
        const content = choice.delta?.content
        if (typeof content === 'string' && content.length > 0) yield { type: 'delta', content }
        for (const delta of choice.delta?.tool_calls ?? []) {
          if (!Number.isInteger(delta.index) || delta.index < 0) {
            throw new Error('LLM 服务返回了无效 tool call index')
          }
          const call = toolCalls.get(delta.index) ?? {
            index: delta.index,
            id: '',
            name: '',
            arguments: '',
          }
          if (!toolCalls.has(delta.index)) toolCalls.set(delta.index, call)
          if (typeof delta.id === 'string') call.id += delta.id
          if (typeof delta.function?.name === 'string') call.name += delta.function.name
          const argumentsDelta = typeof delta.function?.arguments === 'string' ? delta.function.arguments : ''
          call.arguments += argumentsDelta
          yield {
            type: 'tool-call-delta',
            index: delta.index,
            id: call.id,
            name: call.name,
            argumentsDelta,
          }
        }
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
          finishReason = parseFinishReason(choice.finish_reason)
        }
      }
      if (payload.usage != null) {
        yield {
          type: 'usage',
          inputTokens: integerOrZero(payload.usage.prompt_tokens),
          outputTokens: integerOrZero(payload.usage.completion_tokens),
        }
      }
    }
    try {
      let done = false
      while (!done) {
        const read = await reader.read()
        buffer += decoder.decode(read.value, { stream: !read.done })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line === '') {
            for (const event of emitFrame()) {
              if (event === 'done') {
                done = true
                break
              }
              yield event
            }
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }
        if (read.done) {
          if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart())
          for (const event of emitFrame()) {
            if (event === 'done') {
              done = true
              break
            }
            yield event
          }
          if (!receivedDone) throw new Error('LLM 流式响应未以 [DONE] 结束')
          break
        }
      }
    } catch (error) {
      if (signal.aborted) throw requestFailure(error, signal, input.signal, input.settings.requestTimeoutMs)
      throw error
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }

  private async completeOnce(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const timeoutSignal = AbortSignal.timeout(input.settings.requestTimeoutMs)
    const signal = input.signal === undefined ? timeoutSignal : AbortSignal.any([input.signal, timeoutSignal])
    let response: Response
    try {
      response = await fetch(completionUrl(input.settings.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.ctx.llmCredentials.getApiKey(input.settings.providerId)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.settings.model,
          messages: input.messages,
          max_tokens: input.settings.maxOutputTokens,
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...(input.json === true ? { response_format: { type: 'json_object' } } : {}),
          ...providerRequestOptions(input.settings),
        }),
        signal,
      })
    } catch (error) {
      if (signal.aborted) {
        if (input.signal?.aborted === true) throw new Error('LLM 请求已取消', { cause: error })
        throw new Error(`LLM 请求超时（${input.settings.requestTimeoutMs}ms）`, { cause: error })
      }
      throw new Error(`无法连接 LLM 服务：${errorMessage(error)}`, { cause: error })
    }

    const raw = await response.text()
    let payload: CompletionResponse
    try {
      payload = JSON.parse(raw) as CompletionResponse
    } catch {
      throw new Error(`LLM 服务返回了无效 JSON（HTTP ${response.status}）`)
    }
    if (!response.ok) {
      const message = typeof payload.error?.message === 'string' ? payload.error.message : raw.slice(0, 500)
      throw new Error(`LLM 请求失败（HTTP ${response.status}）：${message}`)
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) throw new Error('LLM 响应缺少文本内容')
    return {
      content,
      inputTokens: integerOrZero(payload.usage?.prompt_tokens),
      outputTokens: integerOrZero(payload.usage?.completion_tokens),
    }
  }

  async testConnection(settings: LlmResolvedEndpoint): Promise<TestLlmConnectionResult> {
    await this.complete({
      settings: { ...settings, maxOutputTokens: Math.min(settings.maxOutputTokens, 16) },
      messages: [{ role: 'user', content: '只回复 OK' }],
      temperature: 0,
      maxAttempts: 1,
    })
    return {
      ok: true,
      providerId: settings.providerId,
      model: settings.model,
      message: `连接成功，模型：${settings.model}`,
    }
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    validateSettings(input.settings)
    if (input.bytes.byteLength === 0) throw new RangeError('录音内容为空')
    const timeoutSignal = AbortSignal.timeout(Math.max(input.settings.requestTimeoutMs, 60_000))
    const signal = input.signal === undefined ? timeoutSignal : AbortSignal.any([input.signal, timeoutSignal])
    const form = new FormData()
    form.set('file', new File([Buffer.from(input.bytes)], input.filename, { type: input.mimeType }))
    form.set('model', input.settings.model)
    form.set('language', 'zh')
    let response: Response
    try {
      response = await fetch(transcriptionUrl(input.settings.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.ctx.llmCredentials.getApiKey(input.settings.providerId)}`,
        },
        body: form,
        signal,
      })
    } catch (error) {
      throw requestFailure(error, signal, input.signal, input.settings.requestTimeoutMs)
    }
    const raw = await response.text()
    let payload: TranscriptionResponse
    try {
      payload = JSON.parse(raw) as TranscriptionResponse
    } catch {
      throw new Error(`语音转写服务返回了无效 JSON（HTTP ${response.status}）`)
    }
    if (!response.ok) {
      const message = typeof payload.error?.message === 'string' ? payload.error.message : raw.slice(0, 500)
      throw new Error(`语音转写失败（HTTP ${response.status}）：${message}`)
    }
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (text.length === 0) throw new Error('语音转写结果为空')
    return { text }
  }
}

interface PartialToolCall {
  index: number
  id: string
  name: string
  arguments: string
}

interface StreamResponse {
  choices?: Array<{
    delta?: {
      content?: unknown
      tool_calls?: Array<{
        index: number
        id?: unknown
        function?: {
          name?: unknown
          arguments?: unknown
        }
      }>
    }
    finish_reason?: unknown
  }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
  } | null
  error?: {
    message?: unknown
  }
}

function completionUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

function transcriptionUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (normalized.endsWith('/chat/completions')) return `${normalized.slice(0, -'/chat/completions'.length)}/audio/transcriptions`
  if (normalized.endsWith('/v1')) return `${normalized}/audio/transcriptions`
  return `${normalized}/audio/transcriptions`
}

function validateSettings(settings: LlmResolvedEndpoint): void {
  if (settings.model.trim().length === 0) throw new RangeError('尚未配置 LLM 模型')
  let url: URL
  try {
    url = new URL(completionUrl(settings.baseUrl))
  } catch {
    throw new RangeError('LLM Base URL 无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RangeError('LLM Base URL 仅支持 http 或 https')
  if (!Number.isInteger(settings.requestTimeoutMs) || settings.requestTimeoutMs < 1) throw new RangeError('LLM 请求超时配置无效')
  if (!Number.isInteger(settings.maxOutputTokens) || settings.maxOutputTokens < 1) throw new RangeError('LLM 最大输出 Token 配置无效')
}

function integerOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function parseFinishReason(value: unknown): ChatCompletionFinishReason {
  if (value === 'stop' || value === 'tool_calls' || value === 'length' || value === 'content_filter') return value
  throw new Error(`LLM 服务返回了未知 finish_reason：${String(value)}`)
}

function validateCompletedToolCalls(calls: ToolCall[]): void {
  if (calls.length === 0) throw new Error('LLM 服务以 tool_calls 结束但没有返回工具调用')
  const ids = new Set<string>()
  for (const call of calls) {
    if (call.id.trim().length === 0) throw new Error('LLM 服务返回了空 tool call id')
    if (ids.has(call.id)) throw new Error(`LLM 服务返回了重复 tool call id：${call.id}`)
    ids.add(call.id)
    if (call.function.name.trim().length === 0) throw new Error(`工具调用 ${call.id} 缺少函数名称`)
  }
}

function providerRequestOptions(settings: LlmResolvedEndpoint): Record<string, unknown> {
  try {
    const hostname = new URL(settings.baseUrl).hostname.toLowerCase()
    if (hostname === 'aliyuncs.com' || hostname.endsWith('.aliyuncs.com')) {
      return { enable_thinking: false }
    }
  } catch {
    // Settings validation reports malformed URLs before a request is sent.
  }
  return {}
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requestFailure(error: unknown, signal: AbortSignal, callerSignal: AbortSignal | undefined, timeoutMs: number): Error {
  if (signal.aborted) {
    if (callerSignal?.aborted === true) return new Error('LLM 请求已取消', { cause: error })
    return new Error(`LLM 请求超时（${timeoutMs}ms）`, { cause: error })
  }
  return new Error(`无法连接 LLM 服务：${errorMessage(error)}`, { cause: error })
}

function isRetryable(error: unknown): boolean {
  const message = errorMessage(error)
  return message.includes('请求超时')
    || message.includes('无法连接 LLM 服务')
    || /HTTP (429|5\d\d)/.test(message)
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) throw new Error('LLM 请求已取消')
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('LLM 请求已取消'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export default OpenAiCompatibleClient
