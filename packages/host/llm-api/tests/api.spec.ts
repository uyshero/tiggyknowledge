import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import HttpRouter, { HttpError } from '@tiggyknowledge/http-router'
import { describe, expect, it, vi } from 'vitest'
import LlmApi from '../src/index.ts'

const settings = {
  providers: [{
    id: 'test-provider',
    name: '测试提供方',
    baseUrl: 'https://llm.example/v1',
    requestTimeoutMs: 5_000,
    maxInputTokens: 10_000,
    maxOutputTokens: 1_000,
    models: [{ id: 'test-model', name: 'test-model', model: 'test-model' }],
    apiKeyConfigured: true,
    apiKeyPreview: 'sk-tes…alue',
  }],
  preferredModelId: 'test-model',
}

describe('LLM HTTP API plugin', () => {
  it('registers its own routes and contributes LLM system state', async () => {
    const ctx = new Context()
    const updateLlmIntegration = vi.fn()
    ctx.provide('settings', {
      updateLlmIntegration,
      llmIntegration: () => settings,
    })
    ctx.provide('llmCredentials', {
      status: () => ({ configured: true, preview: 'sk-tes…alue' }),
      setApiKey: vi.fn(),
    })
    const testConnection = vi.fn(async () => ({
      ok: true,
      providerId: 'test-provider',
      model: 'test-model',
      message: '连接成功，模型：test-model',
    }))
    ctx.provide('llmClient', { testConnection })

    let server: ReturnType<typeof createServer> | undefined
    try {
      await ctx.plugin(HttpRouter)
      await ctx.plugin(LlmApi)
      expect(ctx.httpRouter.snapshot()).toMatchObject({
        llm: { preferredModelId: 'test-model', providers: [{ id: 'test-provider', apiKeyConfigured: true }] },
      })

      server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        void ctx.httpRouter.dispatch(request, response, url).then(handled => {
          if (!handled) {
            response.writeHead(404)
            response.end()
          }
        }).catch((error: unknown) => {
          if (error instanceof HttpError) {
            response.writeHead(error.status, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ error: error.code, message: error.message }))
            return
          }
          response.writeHead(500)
          response.end()
        })
      })
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject)
        server?.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address() as AddressInfo
      const baseUrl = `http://127.0.0.1:${address.port}`

      const status = await fetch(`${baseUrl}/api/wiki/status`)
      expect(status.status).toBe(404)

      const update = await fetch(`${baseUrl}/api/settings/llm`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ preferredModelId: 'test-model' }),
      })
      expect(update.status).toBe(200)
      await expect(update.json()).resolves.toMatchObject({ preferredModelId: 'test-model' })
      expect(updateLlmIntegration).toHaveBeenCalledWith({ preferredModelId: 'test-model' })

      const tested = await fetch(`${baseUrl}/api/settings/llm/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ providerId: 'test-provider' }),
      })
      expect(tested.status).toBe(200)
      await expect(tested.json()).resolves.toMatchObject({ ok: true, providerId: 'test-provider', model: 'test-model' })
      expect(testConnection).toHaveBeenCalledOnce()
    } finally {
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => server?.close(error => error === undefined ? resolve() : reject(error)))
      }
      await ctx.fiber.dispose()
    }
  })
})
