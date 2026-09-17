import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import HttpRouter, { HttpError } from '@tiggyknowledge/http-router'
import { describe, expect, it, vi } from 'vitest'
import LibraryChatApi from '../src/index.ts'

describe('library chat HTTP API', () => {
  it('serves snapshots, same-origin mutations and SSE events', async () => {
    const snapshot = vi.fn(() => ({ libraryId: 'lib a', messages: [] }))
    const clear = vi.fn()
    const cancel = vi.fn(() => undefined)
    const start = vi.fn(() => (async function* () {
      yield { type: 'delta' as const, messageId: 'a1', delta: '你好' }
      yield {
        type: 'completed' as const,
        message: {
          id: 'a1',
          libraryId: 'lib a',
          role: 'assistant' as const,
          state: 'completed' as const,
          content: '你好',
          sources: [],
          tokenUsage: { inputTokens: 3, outputTokens: 1 },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
        },
      }
    })())
    const ctx = new Context()
    ctx.provide('libraryChat', { snapshot, clear, cancel, start })
    let server: ReturnType<typeof createServer> | undefined
    try {
      await ctx.plugin(HttpRouter)
      await ctx.plugin(LibraryChatApi)
      server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        void ctx.httpRouter.dispatch(request, response, url).then(handled => {
          if (!handled) {
            response.writeHead(404)
            response.end()
          }
        }).catch((error: unknown) => {
          const status = error instanceof HttpError ? error.status : 500
          response.writeHead(status, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }))
        })
      })
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject)
        server?.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address() as AddressInfo
      const baseUrl = `http://127.0.0.1:${address.port}`

      const get = await fetch(`${baseUrl}/api/libraries/lib%20a/chat`)
      expect(await get.json()).toEqual({ libraryId: 'lib a', messages: [] })

      const rejected = await fetch(`${baseUrl}/api/libraries/lib%20a/chat/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '问题' }),
      })
      expect(rejected.status).toBe(403)

      const invalidOverride = await fetch(`${baseUrl}/api/libraries/lib%20a/chat/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ content: '问题', taskOverride: 'anything' }),
      })
      expect(invalidOverride.status).toBe(400)
      expect(start).not.toHaveBeenCalled()

      const sent = await fetch(`${baseUrl}/api/libraries/lib%20a/chat/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ content: '问题', modelId: 'model-1' }),
      })
      expect(sent.headers.get('content-type')).toContain('text/event-stream')
      const body = await sent.text()
      expect(body).toContain('event: delta')
      expect(body).toContain('"delta":"你好"')
      expect(body).toContain('event: completed')
      expect(start).toHaveBeenCalledWith('lib a', { content: '问题', modelId: 'model-1' })

      const deleted = await fetch(`${baseUrl}/api/libraries/lib%20a/chat`, {
        method: 'DELETE',
        headers: { origin: baseUrl },
      })
      expect(deleted.status).toBe(200)
      expect(clear).toHaveBeenCalledWith('lib a')
    } finally {
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => server?.close(error => error === undefined ? resolve() : reject(error)))
      }
      await ctx.fiber.dispose()
    }
  })
})
