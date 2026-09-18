import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import HttpRouter, { HttpError } from '@tiggyknowledge/http-router'
import { describe, expect, it } from 'vitest'
import LlmWiki from '../src/index.ts'

describe('LLM Wiki HTTP surface', () => {
  it('serves wiki routes from the wiki plugin without llm-api', async () => {
    const ctx = new Context()
    ctx.provide('knowledgeCatalog', {
      listLibraries: () => [],
      listDocuments: () => [],
    })
    ctx.provide('knowledgePreview', {})
    ctx.provide('llmClient', {})
    ctx.provide('llmCredentials', {
      status: () => ({ configured: false }),
    })
    ctx.provide('settings', {
      llmIntegration: () => ({ providers: [] }),
    })
    ctx.provide('wikiStorage', {
      activeGeneration: () => undefined,
      latestGeneration: () => undefined,
      lastGeneratedAt: () => undefined,
      listPages: () => [],
      listDocumentSnapshots: () => [],
      listInboxSkips: () => [],
      isInboxSkipped: () => false,
      pagesForDocument: () => [],
    })

    let server: ReturnType<typeof createServer> | undefined
    try {
      await ctx.plugin(HttpRouter)
      await ctx.plugin(LlmWiki)
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
      const status = await fetch(`http://127.0.0.1:${address.port}/api/wiki/status`)
      expect(status.status).toBe(200)
      await expect(status.json()).resolves.toMatchObject({
        state: 'never-generated',
        pageCount: 0,
        llmConfigured: false,
      })
    } finally {
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => server?.close(error => error === undefined ? resolve() : reject(error)))
      }
      await ctx.fiber.dispose()
    }
  })
})
