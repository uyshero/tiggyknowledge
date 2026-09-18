import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import ClientBootstrap from '@tiggyknowledge/client-bootstrap'
import HttpRouter, { HttpError } from '@tiggyknowledge/http-router'
import CatalogSqlite from '../src/index.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async server => await new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })))
})

async function listen(ctx: Context): Promise<string> {
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
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

describe('catalog HTTP surface', () => {
  it('exposes library routes and a knowledge UI companion after the kernel appears', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-catalog-surface-'))
    const ctx = new Context()
    try {
      await ctx.plugin(CatalogSqlite, { dataDir })
      await ctx.plugin(HttpRouter)
      await ctx.plugin(ClientBootstrap, {
        plugins: [{
          id: 'client-ui-layout',
          moduleName: '@tiggyknowledge/client-ui-layout',
          label: 'Layout',
          description: 'Application shell and React renderer',
        }],
      })
      expect(ctx.httpRouter.snapshot()).toMatchObject({ catalog: { libraries: 0, documents: 0 } })
      expect(ctx.clientBootstrap.manifest().plugins.map(plugin => plugin.id)).toEqual([
        'client-ui-knowledge',
        'client-ui-layout',
      ])

      const baseUrl = await listen(ctx)
      const created = await fetch(`${baseUrl}/api/libraries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ name: '研发资料' }),
      })
      expect(created.status).toBe(201)
      const library = await created.json() as { id: string, name: string }
      expect(library.name).toBe('研发资料')
      const listed = await fetch(`${baseUrl}/api/libraries`)
      expect(listed.status).toBe(200)
      await expect(listed.json()).resolves.toMatchObject({ items: [{ id: library.id, name: '研发资料' }] })
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
