import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import HttpRouter, { HttpError } from '@tiggyknowledge/http-router'
import { describe, expect, it, vi } from 'vitest'
import LlmApi from '../src/index.ts'

describe('LLM HTTP API plugin', () => {
  it('registers its own routes and contributes LLM system state', async () => {
    const ctx = new Context()
    let enabled = false
    const updateLlmIntegration = vi.fn((input: { enabled?: boolean }) => {
      if (input.enabled !== undefined) enabled = input.enabled
    })
    ctx.provide('settings', {
      updateLlmIntegration,
      llmIntegration: (configured: boolean, preview?: string) => ({
        enabled,
        baseUrl: 'https://llm.example/v1',
        model: 'test-model',
        requestTimeoutMs: 5_000,
        maxInputTokens: 10_000,
        maxOutputTokens: 1_000,
        apiKeyConfigured: configured,
        ...(preview === undefined ? {} : { apiKeyPreview: preview }),
      }),
    })
    ctx.provide('llmCredentials', {
      snapshot: () => ({ configured: true, preview: 'sk-tes…alue' }),
      setApiKey: vi.fn(),
    })
    ctx.provide('llmClient', { testConnection: vi.fn() })
    ctx.provide('llmWiki', {
      status: () => ({ state: 'ready', llmConfigured: true, pageCount: 2, changes: { totalDocuments: 3, added: 0, updated: 0, deleted: 0 } }),
    })

    let server: ReturnType<typeof createServer> | undefined
    try {
      await ctx.plugin(HttpRouter)
      await ctx.plugin(LlmApi)
      expect(ctx.httpRouter.snapshot()).toMatchObject({
        llm: { enabled: false, model: 'test-model', apiKeyConfigured: true },
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
      expect(status.status).toBe(200)
      await expect(status.json()).resolves.toMatchObject({ state: 'ready', pageCount: 2 })

      const update = await fetch(`${baseUrl}/api/settings/llm`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ enabled: true }),
      })
      expect(update.status).toBe(200)
      await expect(update.json()).resolves.toMatchObject({ enabled: true, apiKeyConfigured: true })
      expect(updateLlmIntegration).toHaveBeenCalledWith({ enabled: true })
    } finally {
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => server?.close(error => error === undefined ? resolve() : reject(error)))
      }
      await ctx.fiber.dispose()
    }
  })
})
