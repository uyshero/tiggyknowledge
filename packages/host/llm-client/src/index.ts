import { Context, Service } from '@deepseek-ai/cordis'
import type { LlmIntegrationSettings, TestLlmConnectionResult } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/llm-credentials'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmClient: OpenAiCompatibleClient
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionInput {
  settings: LlmIntegrationSettings
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

  private async completeOnce(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const timeoutSignal = AbortSignal.timeout(input.settings.requestTimeoutMs)
    const signal = input.signal === undefined ? timeoutSignal : AbortSignal.any([input.signal, timeoutSignal])
    let response: Response
    try {
      response = await fetch(completionUrl(input.settings.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.ctx.llmCredentials.getApiKey()}`,
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

  async testConnection(settings: LlmIntegrationSettings): Promise<TestLlmConnectionResult> {
    await this.complete({
      settings: { ...settings, maxOutputTokens: Math.min(settings.maxOutputTokens, 16) },
      messages: [{ role: 'user', content: '只回复 OK' }],
      temperature: 0,
      maxAttempts: 1,
    })
    return { ok: true, model: settings.model, message: 'LLM 连接成功' }
  }
}

function completionUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

function validateSettings(settings: LlmIntegrationSettings): void {
  if (!settings.enabled) throw new RangeError('LLM 集成尚未启用')
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

function providerRequestOptions(settings: LlmIntegrationSettings): Record<string, unknown> {
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
