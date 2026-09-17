import { Context } from '@deepseek-ai/cordis'
import type { LlmResolvedEndpoint } from '@tiggyknowledge/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenAiCompatibleClient from '../src/index.ts'

const settings: LlmResolvedEndpoint = {
  providerId: 'test-provider',
  providerName: '测试提供方',
  modelId: 'test-model',
  modelName: 'test-model',
  baseUrl: 'https://llm.example.test/v1/',
  model: 'test-model',
  requestTimeoutMs: 5_000,
  maxInputTokens: 10_000,
  maxOutputTokens: 500,
  apiKeyConfigured: true,
}

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI-compatible LLM client', () => {
  it('sends authenticated chat completions and returns token usage', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '完成' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    ctx.provide('llmCredentials', { getApiKey: (providerId: string) => {
      expect(providerId).toBe('test-provider')
      return 'sk-test-key'
    } })
    try {
      await ctx.plugin(OpenAiCompatibleClient)
      await expect(ctx.llmClient.complete({
        settings,
        messages: [{ role: 'user', content: '你好' }],
        json: true,
      })).resolves.toEqual({ content: '完成', inputTokens: 12, outputTokens: 3 })

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, request] = fetchMock.mock.calls[0] ?? []
      expect(url).toBe('https://llm.example.test/v1/chat/completions')
      expect(request?.headers).toMatchObject({ authorization: 'Bearer sk-test-key' })
      expect(JSON.parse(String(request?.body))).toMatchObject({
        model: 'test-model',
        max_tokens: 500,
        response_format: { type: 'json_object' },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('surfaces provider errors without accepting empty success payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'invalid credentials' },
    }), { status: 401 })))
    const ctx = new Context()
    ctx.provide('llmCredentials', { getApiKey: () => 'sk-invalid' })
    try {
      await ctx.plugin(OpenAiCompatibleClient)
      await expect(ctx.llmClient.complete({
        settings,
        messages: [{ role: 'user', content: '你好' }],
      })).rejects.toThrow(/HTTP 401.*invalid credentials/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('retries transient provider failures when requested', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'OK' } }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    ctx.provide('llmCredentials', { getApiKey: () => 'sk-test-key' })
    try {
      await ctx.plugin(OpenAiCompatibleClient)
      const result = ctx.llmClient.complete({
        settings,
        messages: [{ role: 'user', content: '你好' }],
        maxAttempts: 2,
      })
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(result).resolves.toMatchObject({ content: 'OK' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      await ctx.fiber.dispose()
    }
  })

  it('disables thinking for Alibaba OpenAI-compatible endpoints', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"pages":[]}' } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    ctx.provide('llmCredentials', { getApiKey: () => 'sk-test-key' })
    try {
      await ctx.plugin(OpenAiCompatibleClient)
      await ctx.llmClient.complete({
        settings: { ...settings, baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
        messages: [{ role: 'user', content: '生成 JSON' }],
      })
      const request = fetchMock.mock.calls[0]?.[1]
      expect(JSON.parse(String(request?.body))).toMatchObject({ enable_thinking: false })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('parses OpenAI-compatible SSE deltas, usage and DONE frames', async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[],"usage":null}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"好"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } })))
    const ctx = new Context()
    ctx.provide('llmCredentials', { getApiKey: () => 'sk-test-key' })
    try {
      await ctx.plugin(OpenAiCompatibleClient)
      const events = []
      for await (const event of ctx.llmClient.stream({
        settings,
        messages: [{ role: 'user', content: '你好' }],
      })) events.push(event)
      expect(events).toEqual([
        { type: 'delta', content: '你' },
        { type: 'delta', content: '好' },
        { type: 'usage', inputTokens: 7, outputTokens: 2 },
        { type: 'finish', reason: 'stop' },
      ])
      const request = vi.mocked(fetch).mock.calls[0]?.[1]
      expect(JSON.parse(String(request?.body))).toMatchObject({
        stream: true,
        stream_options: { include_usage: true },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('surfaces malformed SSE and caller cancellation', async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal?.aborted === true) throw new DOMException('Aborted', 'AbortError')
      return new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
          controller.enqueue(encoder.encode('data: not-json\n\n'))
        },
      }), { status: 200 })
    }))
    const ctx = new Context()
    ctx.provide('llmCredentials', { getApiKey: () => 'sk-test-key' })
    try {
      await ctx.plugin(OpenAiCompatibleClient)
      const malformed = ctx.llmClient.stream({ settings, messages: [{ role: 'user', content: '你好' }] })
      await expect(malformed.next()).rejects.toThrow('无效 SSE JSON')

      const controller = new AbortController()
      const cancelled = ctx.llmClient.stream({
        settings,
        messages: [{ role: 'user', content: '你好' }],
        signal: controller.signal,
      })
      controller.abort()
      await expect(cancelled.next()).rejects.toThrow('已取消')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('assembles fragmented native function calls and sends tool results', async () => {
    const encoder = new TextEncoder()
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_","function":{"name":"read_","arguments":"{\\"doc"}}]}}]}\n'))
        controller.enqueue(encoder.encode('\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"1","function":{"name":"document","arguments":"umentId\\":\\"doc-1\\"}"}}]},"finish_reason":"tool_calls"}],"usage":null}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":5}}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    ctx.provide('llmCredentials', { getApiKey: () => 'sk-test-key' })
    try {
      await ctx.plugin(OpenAiCompatibleClient)
      const events = []
      for await (const event of ctx.llmClient.stream({
        settings,
        messages: [{
          role: 'assistant',
          tool_calls: [{
            id: 'previous-call',
            type: 'function',
            function: { name: 'lookup', arguments: '{"query":"x"}' },
          }],
        }, {
          role: 'tool',
          tool_call_id: 'previous-call',
          content: '{"result":"ok"}',
        }],
        tools: [{
          type: 'function',
          function: {
            name: 'read_document',
            description: '读取文档',
            parameters: { type: 'object', properties: { documentId: { type: 'string' } } },
          },
        }],
        toolChoice: { type: 'function', function: { name: 'read_document' } },
      })) events.push(event)

      expect(events).toContainEqual({
        type: 'tool-calls',
        toolCalls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'read_document', arguments: '{"documentId":"doc-1"}' },
        }],
      })
      expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' })
      const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      expect(request.messages).toEqual([
        {
          role: 'assistant',
          tool_calls: [{
            id: 'previous-call',
            type: 'function',
            function: { name: 'lookup', arguments: '{"query":"x"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'previous-call', content: '{"result":"ok"}' },
      ])
      expect(request).toMatchObject({
        tools: [{ type: 'function', function: { name: 'read_document' } }],
        tool_choice: { type: 'function', function: { name: 'read_document' } },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not publish truncated tool calls and preserves malformed argument text', async () => {
    const encoder = new TextEncoder()
    const responses = [
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"cut","function":{"name":"lookup","arguments":"{\\"x\\":"}}]},"finish_reason":"length"}]}\n\n',
        'data: [DONE]\n\n',
      ],
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"bad","function":{"name":"lookup","arguments":"{not-json"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ],
    ]
    vi.stubGlobal('fetch', vi.fn(async () => {
      const frames = responses.shift() ?? []
      return new Response(new ReadableStream({
        start(controller) {
          for (const frame of frames) controller.enqueue(encoder.encode(frame))
          controller.close()
        },
      }), { status: 200 })
    }))
    const ctx = new Context()
    ctx.provide('llmCredentials', { getApiKey: () => 'sk-test-key' })
    try {
      await ctx.plugin(OpenAiCompatibleClient)
      const truncated = []
      for await (const event of ctx.llmClient.stream({
        settings,
        messages: [{ role: 'user', content: '截断' }],
      })) truncated.push(event)
      expect(truncated.some(event => event.type === 'tool-calls')).toBe(false)
      expect(truncated.at(-1)).toEqual({ type: 'finish', reason: 'length' })

      const malformed = []
      for await (const event of ctx.llmClient.stream({
        settings,
        messages: [{ role: 'user', content: '畸形参数' }],
      })) malformed.push(event)
      expect(malformed).toContainEqual({
        type: 'tool-calls',
        toolCalls: [{
          id: 'bad',
          type: 'function',
          function: { name: 'lookup', arguments: '{not-json' },
        }],
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects empty or duplicate tool call ids and unknown finish reasons', async () => {
    const encoder = new TextEncoder()
    const responses = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"","function":{"name":"lookup","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"same","function":{"name":"lookup","arguments":"{}"}},{"index":1,"id":"same","function":{"name":"lookup","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"future_reason"}]}\n\n',
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(responses.shift() ?? ''))
        controller.close()
      },
    }), { status: 200 })))
    const ctx = new Context()
    ctx.provide('llmCredentials', { getApiKey: () => 'sk-test-key' })
    try {
      await ctx.plugin(OpenAiCompatibleClient)
      for (const expected of ['空 tool call id', '重复 tool call id', '未知 finish_reason']) {
        const events = ctx.llmClient.stream({ settings, messages: [{ role: 'user', content: '测试' }] })
        await expect(async () => {
          for await (const _event of events) {
            // Consume.
          }
        }).rejects.toThrow(expected)
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
