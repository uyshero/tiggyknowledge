import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import HttpRouter, { HttpError } from '../src/index.ts'

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

describe('HTTP plugin router', () => {
  it('dispatches registered routes, enforces methods, and composes snapshot fields', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(HttpRouter)
      ctx.httpRouter.register({
        id: 'example:read',
        methods: ['GET'],
        path: /^\/api\/example\/([^/]+)$/,
        handler({ json, match }) {
          json({ id: decodeURIComponent(match?.[1] ?? '') })
        },
      })
      ctx.httpRouter.registerSnapshotContributor('example', () => ({ example: { enabled: true } }))
      const baseUrl = await listen(ctx)

      await expect(fetch(`${baseUrl}/api/example/item%201`).then(async response => await response.json()))
        .resolves.toEqual({ id: 'item 1' })
      const rejected = await fetch(`${baseUrl}/api/example/item`, { method: 'POST' })
      expect(rejected.status).toBe(405)
      expect(rejected.headers.get('allow')).toBe('GET')
      expect(ctx.httpRouter.snapshot()).toEqual({ example: { enabled: true } })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('provides same-origin and bounded JSON helpers to plugin routes', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(HttpRouter)
      ctx.httpRouter.register({
        id: 'example:write',
        methods: ['POST'],
        path: '/api/example',
        async handler({ assertSameOrigin, json, readJson }) {
          assertSameOrigin()
          json(await readJson<{ value: string }>(), 201)
        },
      })
      const baseUrl = await listen(ctx)
      const response = await fetch(`${baseUrl}/api/example`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ value: 'saved' }),
      })
      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toEqual({ value: 'saved' })

      const crossOrigin = await fetch(`${baseUrl}/api/example`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
        body: '{}',
      })
      expect(crossOrigin.status).toBe(403)
      await expect(crossOrigin.json()).resolves.toMatchObject({ error: 'invalid_origin' })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
