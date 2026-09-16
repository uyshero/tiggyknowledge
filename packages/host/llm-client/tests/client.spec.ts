import { Context } from '@deepseek-ai/cordis'
import type { LlmIntegrationSettings } from '@tiggyknowledge/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenAiCompatibleClient from '../src/index.ts'

const settings: LlmIntegrationSettings = {
  enabled: true,
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
    ctx.provide('llmCredentials', { getApiKey: () => 'sk-test-key' })
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
})
