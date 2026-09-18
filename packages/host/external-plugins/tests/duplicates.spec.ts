import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import HttpRouter, { HttpError } from '@tiggyknowledge/http-router'
import { describe, expect, it } from 'vitest'
import ExampleDuplicates from '../../../../examples/duplicates/host/src/index.ts'
import ClientBootstrap from '@tiggyknowledge/client-bootstrap'

function document(id: string, libraryId: string, title: string, contentHash: string) {
  return {
    id,
    libraryId,
    title,
    originalName: `${id}.md`,
    sourceType: 'markdown' as const,
    sourceAssetId: `asset-${id}`,
    contentHash,
    sizeBytes: 12,
    indexStatus: 'ready' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
}

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

describe('example duplicates plugin', () => {
  it('groups documents that share a content hash and removes routes when unloaded', async () => {
    const ctx = new Context()
    ctx.provide('knowledgeCatalog', {
      listLibraries: () => [
        { id: 'lib-a', name: '规范' },
        { id: 'lib-b', name: '备份' },
      ],
      listDocuments: (libraryId: string) => libraryId === 'lib-a'
        ? [document('doc-1', 'lib-a', '指南', 'hash-dup'), document('doc-2', 'lib-a', '手册', 'hash-unique')]
        : [document('doc-3', 'lib-b', '指南副本', 'hash-dup')],
    })

    let server: Awaited<ReturnType<typeof listen>> | undefined
    try {
      await ctx.plugin(HttpRouter)
      await ctx.plugin(ClientBootstrap, { plugins: [] })
      const fiber = await ctx.plugin(ExampleDuplicates)
      server = await listen(ctx)

      const listed = await fetch(`${server.baseUrl}/api/ext/example-duplicates/groups`)
      expect(listed.status).toBe(200)
      const body = await listed.json() as { groups: Array<{ contentHash: string, documents: Array<{ id: string, libraryName: string }> }> }
      expect(body.groups).toHaveLength(1)
      expect(body.groups[0]?.contentHash).toBe('hash-dup')
      expect(body.groups[0]?.documents.map(item => item.id).sort()).toEqual(['doc-1', 'doc-3'])
      expect(body.groups[0]?.documents.map(item => item.libraryName).sort()).toEqual(['备份', '规范'])
      expect(ctx.httpRouter.snapshot()).toMatchObject({ exampleDuplicates: { groupCount: 1 } })
      expect(ctx.clientBootstrap.manifest().plugins.map(plugin => plugin.id)).toContain('client-example-duplicates')
      expect(ctx.clientBootstrap.manifest().plugins.find(plugin => plugin.id === 'client-example-duplicates')?.url)
        .toBe('/ext/plugins/example-duplicates/client.js')

      await fiber.dispose()
      const missing = await fetch(`${server.baseUrl}/api/ext/example-duplicates/groups`)
      expect(missing.status).toBe(404)
      expect(ctx.httpRouter.snapshot().exampleDuplicates).toBeUndefined()
      expect(ctx.clientBootstrap.manifest().plugins.map(plugin => plugin.id)).not.toContain('client-example-duplicates')
    } finally {
      await server?.close()
      await ctx.fiber.dispose()
    }
  })
})
