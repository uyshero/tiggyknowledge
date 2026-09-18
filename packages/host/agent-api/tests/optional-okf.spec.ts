import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import HttpRouter, { HttpError } from '@tiggyknowledge/http-router'
import { describe, expect, it } from 'vitest'
import AgentApi from '../src/index.ts'

async function listen(ctx: Context): Promise<{ baseUrl: string, close: () => Promise<void> }> {
  const server = createServer((request, response) => {
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
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}

function provideAgentDeps(ctx: Context): void {
  ctx.provide('appVersion', '0.3.0')
  ctx.provide('knowledgeCatalog', {
    summary: () => ({ dataDirectory: '/tmp/tiggyknowledge' }),
    listLibraries: () => [],
    getDocuments: () => [],
  })
  ctx.provide('knowledgePreview', {})
  ctx.provide('knowledgeQuery', {})
  ctx.provide('knowledgeSemanticCapabilities', {
    snapshot: () => ({ enabledModes: ['keyword'] }),
  })
  ctx.provide('pluginInventory', { list: () => [] })
  ctx.provide('settings', {
    snapshot: () => ({ values: { dshIntegration: {} } }),
    verifyDshIntegrationAccessKey: () => true,
  })
}

describe('agent API optional OKF', () => {
  it('stays active and does not advertise OKF when the plugin is missing', async () => {
    const ctx = new Context()
    provideAgentDeps(ctx)
    let close: (() => Promise<void>) | undefined
    try {
      await ctx.plugin(HttpRouter)
      await ctx.plugin(AgentApi)
      expect(ctx.agentApi).toBeDefined()
      const server = await listen(ctx)
      close = server.close
      const capabilities = await fetch(`${server.baseUrl}/api/capabilities`)
      expect(capabilities.status).toBe(200)
      const body = await capabilities.json() as { capabilities: { operations: Array<{ id: string }> } }
      expect(body.capabilities.operations.map(operation => operation.id)).toEqual([
        'status',
        'libraries',
        'search',
        'read',
      ])
      const okf = await fetch(`${server.baseUrl}/api/tiggyknowledge/documents/doc-1/okf`)
      expect(okf.status).toBe(404)
    } finally {
      await close?.()
      await ctx.fiber.dispose()
    }
  })

  it('registers the OKF route when the plugin is present', async () => {
    const ctx = new Context()
    provideAgentDeps(ctx)
    ctx.provide('knowledgeOkf', {
      mapping: async () => {
        throw new RangeError('知识条目不存在')
      },
    })
    let close: (() => Promise<void>) | undefined
    try {
      await ctx.plugin(HttpRouter)
      await ctx.plugin(AgentApi)
      const server = await listen(ctx)
      close = server.close
      const capabilities = await fetch(`${server.baseUrl}/api/capabilities`)
      await expect(capabilities.json()).resolves.toMatchObject({
        capabilities: {
          operations: expect.arrayContaining([{ id: 'okf', method: 'GET', path: '/api/tiggyknowledge/documents/:id/okf', readOnly: true }]),
        },
      })
      const okf = await fetch(`${server.baseUrl}/api/tiggyknowledge/documents/doc-1/okf`, {
        headers: { authorization: 'Bearer test-key' },
      })
      expect(okf.status).toBe(404)
      await expect(okf.json()).resolves.toMatchObject({ error: 'document_not_found' })
    } finally {
      await close?.()
      await ctx.fiber.dispose()
    }
  })
})
